import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  LLMClient,
  LLMMessage,
  ToolDefinition,
  ToolResultPart,
  ToolUsePart,
} from "./llm/types.js";
import { RuleEngine } from "./engine.js";
import type { ProposedAction, TaskContext } from "./types.js";

const TOOLS: ToolDefinition[] = [
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

export interface AgentOptions {
  cwd: string;
  maxTurns?: number;
}

export async function runAgent(
  taskDescription: string,
  declaredFiles: string[],
  engine: RuleEngine,
  llm: LLMClient,
  opts: AgentOptions
) {
  const maxTurns = opts.maxTurns ?? 25;
  const ctx: TaskContext = { description: taskDescription, declaredFiles };

  const system = [
    "You are a coding agent operating inside a rule-enforcement harness.",
    "Every edit_file and task_complete call is checked against project rules BEFORE it takes",
    "effect. A rejection is not a suggestion — the action did not happen. Read the rejection",
    "reason and adjust; do not repeat the same rejected action.",
    `Declared file scope for this task: ${
      declaredFiles.length
        ? declaredFiles.join(", ")
        : "(none declared — diff-scope 'declared' rules will reject all edits until scope is set)"
    }`,
  ].join(" ");

  const messages: LLMMessage[] = [
    { role: "user", content: [{ type: "text", text: taskDescription }] },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await llm.chat(messages, TOOLS, system);

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (p): p is ToolUsePart => p.type === "tool_use"
    );

    if (toolUses.length === 0) {
      const text = response.content.find((p) => p.type === "text");
      if (text?.type === "text") console.log(`\n[agent] ${text.text}`);
      if (response.stopReason === "end_turn") break;
      continue;
    }

    const toolResults: ToolResultPart[] = [];

    for (const use of toolUses) {
      const result = await handleToolUse(use, engine, ctx, opts.cwd);
      toolResults.push(result);

      const budgetHit = engine.exceededBudget();
      if (budgetHit) {
        console.log(
          `\n[harness] rule "${budgetHit.ruleId}" has failed ${budgetHit.count} times — ` +
            `stopping and escalating to human instead of continuing to retry.`
        );
        return { status: "escalated" as const, rule: budgetHit.ruleId };
      }
    }

    messages.push({ role: "user", content: toolResults });

    const done = toolUses.some(
      (u) => u.name === "task_complete" && !isRejected(toolResults, u.id)
    );
    if (done) return { status: "complete" as const };
  }

  return { status: "max_turns_reached" as const };
}

function isRejected(results: ToolResultPart[], toolUseId: string): boolean {
  return results.find((r) => r.tool_use_id === toolUseId)?.is_error === true;
}

async function handleToolUse(
  use: ToolUsePart,
  engine: RuleEngine,
  ctx: TaskContext,
  cwd: string
): Promise<ToolResultPart> {
  const { input } = use;

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
      const reasons = check.violations.map((v) => `- [${v.ruleId}] ${v.message}`).join("\n");
      console.log(`\n[harness] REJECTED edit to ${input.path}:\n${reasons}`);
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: reasons };
    }

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, input.content as string);
    console.log(`\n[harness] applied edit to ${input.path}`);
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
      return { type: "tool_result", tool_use_id: use.id, content: out || "(no output)" };
    } catch (err: unknown) {
      // execSync throws an object with stdout/stderr buffers on non-zero exit
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      const out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
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
      const reasons = check.violations.map((v) => `- [${v.ruleId}] ${v.message}`).join("\n");
      console.log(`\n[harness] task_complete REJECTED:\n${reasons}`);
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: reasons };
    }
    console.log(`\n[harness] task accepted: ${input.summary}`);
    return { type: "tool_result", tool_use_id: use.id, content: "accepted" };
  }

  return {
    type: "tool_result",
    tool_use_id: use.id,
    is_error: true,
    content: `Unknown tool: ${use.name}`,
  };
}
