import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { RuleEngine } from "./engine.js";
import type { ProposedAction, TaskContext } from "./types.js";

const TOOLS: Anthropic.Tool[] = [
  {
    name: "edit_file",
    description:
      "Create or overwrite a file with new content. This will be checked against project " +
      "rules (scope, forbidden patterns, etc.) before it is applied. If it's rejected, you'll " +
      "get back the specific reason and can revise your approach.",
    input_schema: {
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
    input_schema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  {
    name: "task_complete",
    description:
      "Declare the task finished. This triggers any on_task_complete rule gates (e.g. tests " +
      "must pass) before it is accepted. If a gate fails, you are NOT done — read the failure " +
      "and keep working.",
    input_schema: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
    },
  },
];

export interface AgentOptions {
  cwd: string;
  model?: string;
  maxTurns?: number;
}

export async function runAgent(
  taskDescription: string,
  declaredFiles: string[],
  engine: RuleEngine,
  opts: AgentOptions
) {
  const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const model = opts.model ?? "claude-sonnet-5";
  const maxTurns = opts.maxTurns ?? 25;
  const ctx: TaskContext = { description: taskDescription, declaredFiles };

  const system = [
    "You are a coding agent operating inside a rule-enforcement harness.",
    "Every edit_file and task_complete call is checked against project rules BEFORE it takes",
    "effect. A rejection is not a suggestion — the action did not happen. Read the rejection",
    "reason and adjust; do not repeat the same rejected action.",
    `Declared file scope for this task: ${declaredFiles.length ? declaredFiles.join(", ") : "(none declared — diff-scope 'declared' rules will reject all edits until scope is set)"}`,
  ].join(" ");

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: taskDescription }];

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUses.length === 0) {
      // model just talked — surface it and end the turn loop if it seems done
      const text = response.content.find((b) => b.type === "text");
      if (text && "text" in text) console.log(`\n[agent] ${text.text}`);
      if (response.stop_reason === "end_turn") break;
      continue;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

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

    const done = toolUses.some((u) => u.name === "task_complete" && !isRejected(toolResults, u.id));
    if (done) return { status: "complete" as const };
  }

  return { status: "max_turns_reached" as const };
}

function isRejected(results: Anthropic.ToolResultBlockParam[], toolUseId: string): boolean {
  const r = results.find((r) => r.tool_use_id === toolUseId);
  return r?.is_error === true;
}

async function handleToolUse(
  use: Anthropic.ToolUseBlock,
  engine: RuleEngine,
  ctx: TaskContext,
  cwd: string
): Promise<Anthropic.ToolResultBlockParam> {
  const input = use.input as any;

  if (use.name === "edit_file") {
    const path = join(cwd, input.path);
    const previousContent = existsSync(path) ? readFileSync(path, "utf-8") : undefined;
    const action: ProposedAction = {
      kind: "edit_file",
      path: input.path,
      content: input.content,
      previousContent,
    };

    const check = engine.check(action, ctx);
    if (!check.ok) {
      const reasons = check.violations.map((v) => `- [${v.ruleId}] ${v.message}`).join("\n");
      console.log(`\n[harness] REJECTED edit to ${input.path}:\n${reasons}`);
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: reasons };
    }

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, input.content);
    console.log(`\n[harness] applied edit to ${input.path}`);
    return { type: "tool_result", tool_use_id: use.id, content: "applied" };
  }

  if (use.name === "run_command") {
    const { execSync } = await import("node:child_process");
    try {
      const out = execSync(input.command, { cwd, stdio: "pipe", timeout: 60_000 }).toString();
      return { type: "tool_result", tool_use_id: use.id, content: out || "(no output)" };
    } catch (err: any) {
      const out = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: out };
    }
  }

  if (use.name === "task_complete") {
    const action: ProposedAction = { kind: "task_complete", summary: input.summary };
    const check = engine.check(action, ctx);
    if (!check.ok) {
      const reasons = check.violations.map((v) => `- [${v.ruleId}] ${v.message}`).join("\n");
      console.log(`\n[harness] task_complete REJECTED:\n${reasons}`);
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: reasons };
    }
    console.log(`\n[harness] task accepted: ${input.summary}`);
    return { type: "tool_result", tool_use_id: use.id, content: "accepted" };
  }

  return { type: "tool_result", tool_use_id: use.id, is_error: true, content: "unknown tool" };
}
