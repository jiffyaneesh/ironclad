import type { LLMClient } from "./llm/types.js";
import { RuleEngine } from "./engine.js";
import { runAgent, type AgentEvents, type AgentRunResult } from "./agent.js";
import type { Rule } from "./types.js";

export interface SubagentTaskOptions {
  task: string;
  cwd: string;
  llm: LLMClient;
  rules: Rule[];
  declaredFiles?: string[];
  maxTurns?: number;
  events?: AgentEvents;
}

/**
 * Executes a dedicated subagent in an isolated context.
 * The subagent has its own independent rule engine budget and turn limits.
 */
export async function runSubagent(options: SubagentTaskOptions): Promise<AgentRunResult> {
  const { task, cwd, llm, rules, declaredFiles = [], maxTurns = 15, events } = options;

  // Dedicated rule engine instance with isolated failure counters
  const subagentEngine = new RuleEngine(rules, cwd, { retryBudget: 3 });

  const systemExtra = "\n\nYou are a specialized subagent delegated to complete a focused subtask. Report findings or edits concisely.";

  return await runAgent(task, declaredFiles, subagentEngine, llm, {
    cwd,
    maxTurns,
    events,
    systemExtra,
  });
}
