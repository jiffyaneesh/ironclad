import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
}

export interface AgentOptions {
  cwd: string;
  maxTurns?: number;
  events?: AgentEvents;
  history?: LLMMessage[];
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
    name: "edit_file",
    description:
      "Create or overwrite a file with new content. This will be checked against project " +
      "rules (scope, forbidden patterns, etc.) before it is applied. If it's rejected, you'll " +
      "get back the specific reason and can revise your approach.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the repo root" },
        content: { type: "string", description: "Full new file content" },
      },
      required: ["path", "content"],
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
  ].join(" ");

  const messages: LLMMessage[] = opts.history
    ? [...opts.history, { role: "user", content: [{ type: "text", text: taskDescription }] }]
    : [{ role: "user", content: [{ type: "text", text: taskDescription }] }];

  for (let turn = 0; turn < maxTurns; turn++) {
    events.onTurnStart?.(turn + 1);

    const response = await llm.chat(messages, TOOLS, system);
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

      const result = await handleToolUse(use, engine, ctx, opts.cwd, events);
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
  events: AgentEvents
): Promise<ToolResultPart> {
  const { input } = use;

  if (use.name === "read_file") {
    const relPath = input.path as string;
    const fullPath = join(cwd, relPath);
    if (!existsSync(fullPath)) {
      events.onToolError?.(use.name, `File not found: ${relPath}`);
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: `File not found: ${relPath}` };
    }
    try {
      const content = readFileSync(fullPath, "utf-8");
      events.onToolApplied?.(use.name, `Read ${relPath} (${content.split("\n").length} lines)`);
      return { type: "tool_result", tool_use_id: use.id, content };
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
      events.onToolApplied?.(use.name, `Listed ${relPath} (${entries.length} items)`);
      return { type: "tool_result", tool_use_id: use.id, content: entries.join("\n") };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      events.onToolError?.(use.name, msg);
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: msg };
    }
  }

  if (use.name === "edit_file") {
    const filePath = join(cwd, input.path as string);
    const previousContent = existsSync(filePath) ? readFileSync(filePath, "utf-8") : undefined;
    const action: ProposedAction = {
      kind: "edit_file",
      path: input.path as string,
      content: input.content as string,
      previousContent,
    };

    const check = engine.check(action, ctx);
    if (!check.ok) {
      events.onToolRejected?.(use.name, check.violations);
      const reasons = check.violations.map((v) => `- [${v.ruleId}] ${v.message}`).join("\n");
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: reasons };
    }

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, input.content as string);
    events.onToolApplied?.(use.name, `Updated ${input.path}`);
    return { type: "tool_result", tool_use_id: use.id, content: "applied" };
  }

  if (use.name === "run_command") {
    const { execSync } = await import("node:child_process");
    try {
      const out = execSync(input.command as string, {
        cwd,
        stdio: "pipe",
        timeout: 60_000,
      }).toString();
      events.onToolApplied?.(use.name, `Ran: ${input.command}`);
      return { type: "tool_result", tool_use_id: use.id, content: out || "(no output)" };
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      const out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
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
      events.onToolRejected?.(use.name, check.violations);
      const reasons = check.violations.map((v) => `- [${v.ruleId}] ${v.message}`).join("\n");
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: reasons };
    }
    events.onToolApplied?.(use.name, `Task complete: ${input.summary}`);
    return { type: "tool_result", tool_use_id: use.id, content: "accepted" };
  }

  return {
    type: "tool_result",
    tool_use_id: use.id,
    is_error: true,
    content: `Unknown tool: ${use.name}`,
  };
}
