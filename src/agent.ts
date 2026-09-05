import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { captureSnapshot } from "./snapshot/index.js";
import type { AuditEvent } from "./audit/index.js";
import { dirname, join, relative } from "node:path";
import { truncateOutput } from "./util/truncate.js";
import { compactHistory } from "./util/compaction.js";
import type {
  LLMClient,
  LLMMessage,
  ToolDefinition,
  ToolResultPart,
  ToolUsePart,
} from "./llm/types.js";
import { RuleEngine } from "./engine.js";
import type { ProposedAction, RuleViolation, TaskContext } from "./types.js";

export interface AgentEvents {
  onTurnStart?: (turn: number) => void;
  onAssistantMessage?: (text: string) => void;
  onToolCall?: (toolName: string, input: Record<string, unknown>) => void;
  onToolApplied?: (toolName: string, detail: string) => void;
  onToolRejected?: (toolName: string, violations: RuleViolation[]) => void;
  onToolError?: (toolName: string, error: string) => void;
  /** Fires for every rule violation so callers can write audit logs without agent.ts doing I/O. */
  onAuditEvent?: (event: AuditEvent) => void;
}

export interface AgentOptions {
  cwd: string;
  maxTurns?: number;
  events?: AgentEvents;
  history?: LLMMessage[];
  /** Extra context appended to the system prompt (e.g. active skills content). */
  systemExtra?: string;
  /** Active rules available to the agent (passed to subagent delegations). */
  rules?: import("./types.js").Rule[];
  /** LLM client instance (passed to subagent delegations). */
  llm?: LLMClient;
}

export interface AgentRunResult {
  status: "complete" | "escalated" | "max_turns_reached" | "aborted";
  rule?: string;
  history: LLMMessage[];
  summary?: string;
}

const TOOLS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read the content of a file in the repository.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the repo root" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    description: "List files and directories in a given path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory path (e.g. '.' or 'src')" },
      },
      required: ["path"],
    },
  },
  {
    name: "grep_search",
    description: "Search for regex patterns across files in the workspace (fast code search).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Regex pattern or keyword to search for" },
        path: { type: "string", description: "Directory to search within (default: .)" },
        include: { type: "string", description: "File glob filter, e.g. '*.ts'" },
      },
      required: ["query"],
    },
  },
  {
    name: "find_files",
    description: "Find file paths matching a glob pattern across the workspace (e.g. '**/*.ts', 'src/**/*.test.ts').",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern to match" },
        path: { type: "string", description: "Root directory for the search (default: .)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "edit_file",
    description:
      "Create or edit a file. Supports both surgical search-and-replace (provide path + old_string + new_string) " +
      "or full replacement (provide path + content). This is checked against project rules (scope, forbidden patterns, protected paths) " +
      "before anything is written to disk.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the repo root" },
        content: { type: "string", description: "Full new file content (for creating or rewriting full file)" },
        old_string: { type: "string", description: "Exact text snippet to replace in existing file" },
        new_string: { type: "string", description: "Replacement text snippet" },
      },
      required: ["path"],
    },
  },
  {
    name: "run_command",
    description: "Run a shell command in the repo root and see its output.",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "Shell command to run" } },
      required: ["command"],
    },
  },
  {
    name: "delegate_task",
    description:
      "Spawn an isolated subagent to perform a focused subtask (e.g. codebase exploration, test running, specialized refactoring). " +
      "The subagent runs in its own context window with its own independent rule budget and reports back a concise summary.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "Clear, detailed prompt instructions for the subagent" },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of declared files this subagent is allowed to touch",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "task_complete",
    description:
      "Declare the task finished. This triggers any on_task_complete rule gates (e.g. tests " +
      "must pass) before it is accepted. If a gate fails, you are NOT done — read the failure " +
      "and keep working.",
    parameters: {
      type: "object",
      properties: { summary: { type: "string", description: "What was done" } },
      required: ["summary"],
    },
  },
];

export async function runAgent(
  taskDescription: string,
  declaredFiles: string[],
  engine: RuleEngine,
  llm: LLMClient,
  opts: AgentOptions
): Promise<AgentRunResult> {
  const maxTurns = opts.maxTurns ?? 25;
  const ctx: TaskContext = { description: taskDescription, declaredFiles };
  const events = opts.events ?? {};

  const system = [
    "You are an expert coding assistant working in a rule-enforced repository harness.",
    "Every edit_file and task_complete call is verified against mechanical rules BEFORE execution.",
    "If a rule rejects your action, inspect the violation, explain your fix, and retry.",
    "Explore the code using read_file or list_dir if you need context.",
    `Declared file scope for this task: ${
      declaredFiles.length
        ? declaredFiles.join(", ")
        : "(all files allowed unless restricted by glob rules)"
    }`,
  ].join(" ") + (opts.systemExtra ?? "");

  const messages: LLMMessage[] = opts.history
    ? [...opts.history, { role: "user", content: [{ type: "text", text: taskDescription }] }]
    : [{ role: "user", content: [{ type: "text", text: taskDescription }] }];

  for (let turn = 0; turn < maxTurns; turn++) {
    events.onTurnStart?.(turn + 1);

    // Compact older tool results to conserve TPM quota and stay within token limits
    const optimizedMessages = compactHistory(messages, 2);
    const response = await llm.chat(optimizedMessages, TOOLS, system);
    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (p): p is ToolUsePart => p.type === "tool_use"
    );

    if (toolUses.length === 0) {
      const text = response.content.find((p) => p.type === "text");
      if (text?.type === "text" && text.text.trim()) {
        events.onAssistantMessage?.(text.text);
      }
      if (response.stopReason === "end_turn") break;
      continue;
    }

    const toolResults: ToolResultPart[] = [];
    let completedSummary: string | undefined;

    for (const use of toolUses) {
      events.onToolCall?.(use.name, use.input);

      const result = await handleToolUse(use, engine, ctx, opts.cwd, events, opts.rules, llm);
      toolResults.push(result);

      if (use.name === "task_complete" && !result.is_error) {
        completedSummary = (use.input.summary as string) || "Task completed successfully";
      }

      const budgetHit = engine.exceededBudget();
      if (budgetHit) {
        return {
          status: "escalated",
          rule: budgetHit.ruleId,
          history: messages,
        };
      }
    }

    messages.push({ role: "user", content: toolResults });

    if (completedSummary) {
      return {
        status: "complete",
        summary: completedSummary,
        history: messages,
      };
    }
  }

  return { status: "max_turns_reached", history: messages };
}

async function handleToolUse(
  use: ToolUsePart,
  engine: RuleEngine,
  ctx: TaskContext,
  cwd: string,
  events: AgentEvents,
  rules?: import("./types.js").Rule[],
  llm?: LLMClient
): Promise<ToolResultPart> {
  const { input } = use;

  /** Fires onToolRejected + onAuditEvent for every violation in the check result. */
  function emitRejection(violations: RuleViolation[]): void {
    events.onToolRejected?.(use.name, violations);
    const taskSnippet = ctx.description.slice(0, 80);
    for (const v of violations) {
      events.onAuditEvent?.({
        timestamp: new Date().toISOString(),
        severity: v.blocking ? "BLOCKED" : "WARNING",
        ruleId: v.ruleId,
        message: v.message,
        toolName: use.name,
        filePath: use.name === "edit_file" ? (input.path as string | undefined) : undefined,
        command: use.name === "run_command" ? (input.command as string | undefined) : undefined,
        taskDescription: taskSnippet,
      });
    }
  }

  if (use.name === "read_file") {
    const relPath = input.path as string;
    const fullPath = join(cwd, relPath);
    if (!existsSync(fullPath)) {
      events.onToolError?.(use.name, `File not found: ${relPath}`);
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: `File not found: ${relPath}` };
    }
    try {
      const content = readFileSync(fullPath, "utf-8");
      const truncated = truncateOutput(content);
      events.onToolApplied?.(use.name, `Read ${relPath} (${truncated.totalLines} lines)`);
      return { type: "tool_result", tool_use_id: use.id, content: truncated.content };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      events.onToolError?.(use.name, msg);
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: msg };
    }
  }

  if (use.name === "list_dir") {
    const relPath = (input.path as string) || ".";
    const fullPath = join(cwd, relPath);
    if (!existsSync(fullPath)) {
      events.onToolError?.(use.name, `Directory not found: ${relPath}`);
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: `Directory not found: ${relPath}` };
    }
    try {
      const entries = readdirSync(fullPath).map((entry) => {
        const isDir = statSync(join(fullPath, entry)).isDirectory();
        return `${entry}${isDir ? "/" : ""}`;
      });
      const truncated = truncateOutput(entries.join("\n"));
      events.onToolApplied?.(use.name, `Listed ${relPath} (${entries.length} items)`);
      return { type: "tool_result", tool_use_id: use.id, content: truncated.content };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      events.onToolError?.(use.name, msg);
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: msg };
    }
  }

  if (use.name === "grep_search") {
    const query = input.query as string;
    const searchDir = join(cwd, (input.path as string) || ".");
    const includeFilter = input.include as string | undefined;

    if (!existsSync(searchDir)) {
      events.onToolError?.(use.name, `Directory not found: ${input.path || "."}`);
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: `Directory not found: ${input.path || "."}` };
    }

    try {
      const { execSync } = await import("node:child_process");
      const globFlag = includeFilter ? `--glob "${includeFilter}"` : "";
      let rawOut = "";
      try {
        rawOut = execSync(`rg -n ${globFlag} "${query.replace(/"/g, '\\"')}" .`, {
          cwd: searchDir,
          stdio: "pipe",
          timeout: 20_000,
        }).toString();
      } catch (rgErr: any) {
        if (rgErr.status === 1) {
          rawOut = "No matches found.";
        } else {
          try {
            rawOut = execSync(`grep -rn "${query.replace(/"/g, '\\"')}" .`, {
              cwd: searchDir,
              stdio: "pipe",
              timeout: 20_000,
            }).toString();
          } catch (grepErr: any) {
            rawOut = grepErr.status === 1 ? "No matches found." : (grepErr.stderr?.toString() ?? "Search error");
          }
        }
      }

      const truncated = truncateOutput(rawOut || "No matches found.");
      events.onToolApplied?.(use.name, `grep "${query}" (${truncated.totalLines} lines)`);
      return { type: "tool_result", tool_use_id: use.id, content: truncated.content };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      events.onToolError?.(use.name, msg);
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: msg };
    }
  }

  if (use.name === "find_files") {
    const pattern = input.pattern as string;
    const baseDir = join(cwd, (input.path as string) || ".");

    if (!existsSync(baseDir)) {
      events.onToolError?.(use.name, `Directory not found: ${input.path || "."}`);
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: `Directory not found: ${input.path || "."}` };
    }

    try {
      const { minimatch } = await import("minimatch");
      const collectFiles = (dir: string, relBase = ""): string[] => {
        const entries = readdirSync(dir, { withFileTypes: true });
        const files: string[] = [];
        for (const entry of entries) {
          if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
          const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            files.push(...collectFiles(join(dir, entry.name), relPath));
          } else {
            if (minimatch(relPath, pattern, { dot: true })) {
              files.push(relPath);
            }
          }
        }
        return files;
      };

      const matches = collectFiles(baseDir);
      const output = matches.length ? matches.join("\n") : "No files matched pattern";
      const truncated = truncateOutput(output);
      events.onToolApplied?.(use.name, `Matched ${matches.length} files`);
      return { type: "tool_result", tool_use_id: use.id, content: truncated.content };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      events.onToolError?.(use.name, msg);
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: msg };
    }
  }

  if (use.name === "edit_file") {
    const filePath = join(cwd, input.path as string);
    const fileExists = existsSync(filePath);
    const previousContent = fileExists ? readFileSync(filePath, "utf-8") : undefined;

    let targetContent = input.content as string | undefined;

    // Handle surgical replacement if old_string is provided
    if (input.old_string !== undefined && input.new_string !== undefined) {
      if (!fileExists || previousContent === undefined) {
        events.onToolError?.(use.name, `Cannot search/replace: file does not exist at ${input.path}`);
        return {
          type: "tool_result",
          tool_use_id: use.id,
          is_error: true,
          content: `File "${input.path}" does not exist. Use content parameter to create a new file.`,
        };
      }
      const oldStr = input.old_string as string;
      const newStr = input.new_string as string;
      if (!previousContent.includes(oldStr)) {
        events.onToolError?.(use.name, `old_string not found in ${input.path}`);
        return {
          type: "tool_result",
          tool_use_id: use.id,
          is_error: true,
          content: `Target text (old_string) was not found in ${input.path}. Inspect the file with read_file first.`,
        };
      }
      targetContent = previousContent.replace(oldStr, newStr);
    }

    if (targetContent === undefined) {
      events.onToolError?.(use.name, `Missing content or old_string/new_string for ${input.path}`);
      return {
        type: "tool_result",
        tool_use_id: use.id,
        is_error: true,
        content: `Either content OR (old_string and new_string) must be specified for edit_file.`,
      };
    }

    const action: ProposedAction = {
      kind: "edit_file",
      path: input.path as string,
      content: targetContent,
      previousContent,
    };

    const check = engine.check(action, ctx);
    if (!check.ok) {
      emitRejection(check.violations);
      const reasons = check.violations.map((v) => `- [${v.ruleId}] ${v.message}`).join("\n");
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: reasons };
    }

    // Auto-snapshot existing file before overwriting so /rollback can restore it
    if (fileExists) {
      captureSnapshot(cwd, [input.path as string]);
    }

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, targetContent);
    events.onToolApplied?.(use.name, `Updated ${input.path}`);
    return { type: "tool_result", tool_use_id: use.id, content: "applied" };
  }

  if (use.name === "run_command") {
    const cmdAction: ProposedAction = {
      kind: "run_command",
      command: input.command as string,
    };
    const check = engine.check(cmdAction, ctx);
    if (!check.ok) {
      emitRejection(check.violations);
      const reasons = check.violations.map((v) => `- [${v.ruleId}] ${v.message}`).join("\n");
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: reasons };
    }

    const { execSync } = await import("node:child_process");
    try {
      const rawOut = execSync(input.command as string, {
        cwd,
        stdio: "pipe",
        timeout: 60_000,
      }).toString();
      const out = truncateOutput(rawOut || "(no output)").content;
      events.onToolApplied?.(use.name, `Ran: ${input.command}`);
      return { type: "tool_result", tool_use_id: use.id, content: out };
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      const rawOut = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
      const out = truncateOutput(rawOut).content;
      events.onToolError?.(use.name, `Exit failure for: ${input.command}`);
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: out };
    }
  }

  if (use.name === "task_complete") {
    const action: ProposedAction = {
      kind: "task_complete",
      summary: input.summary as string,
    };
    const check = engine.check(action, ctx);
    if (!check.ok) {
      emitRejection(check.violations);
      const reasons = check.violations.map((v) => `- [${v.ruleId}] ${v.message}`).join("\n");
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: reasons };
    }
    events.onToolApplied?.(use.name, `Task complete: ${input.summary}`);
    return { type: "tool_result", tool_use_id: use.id, content: "accepted" };
  }

  if (use.name === "delegate_task") {
    if (!llm || !rules) {
      events.onToolError?.(use.name, "Subagent delegation unavailable (missing LLM or rules context)");
      return {
        type: "tool_result",
        tool_use_id: use.id,
        is_error: true,
        content: "Subagent delegation unavailable in current context.",
      };
    }

    const taskStr = input.task as string;
    const subFiles = (input.files as string[]) || [];
    const { runSubagent } = await import("./subagent.js");

    events.onToolApplied?.(use.name, `Spawning subagent: "${taskStr.slice(0, 40)}..."`);
    const subResult = await runSubagent({
      task: taskStr,
      cwd,
      llm,
      rules,
      declaredFiles: subFiles,
      maxTurns: 10,
    });

    const summary = subResult.summary || (subResult.status === "complete" ? "Subtask finished successfully." : `Subtask ended with status: ${subResult.status}`);
    return {
      type: "tool_result",
      tool_use_id: use.id,
      content: `[Subagent Result]: ${summary}`,
    };
  }

  return {
    type: "tool_result",
    tool_use_id: use.id,
    is_error: true,
    content: `Unknown tool: ${use.name}`,
  };
}
