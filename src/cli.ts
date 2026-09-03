#!/usr/bin/env node
import "dotenv/config";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadRules } from "./ruleLoader.js";
import { RuleEngine } from "./engine.js";
import { runAgent } from "./agent.js";
import { createLLMClient, type Provider } from "./llm/index.js";
import { startInteractiveSession } from "./ui/session.js";
import {
  printAssistantMessage,
  printToolCall,
  printToolApplied,
  printToolRejected,
  printToolError,
  printTaskDone,
  printEscalation,
} from "./ui/printer.js";
import ora from "ora";
import chalk from "chalk";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);

  function flag(name: string): string | undefined {
    const idx = args.indexOf(name);
    return idx >= 0 ? args[idx + 1] : undefined;
  }

  const task = flag("--task");

  return {
    task,
    files: flag("--files")?.split(",").map((f) => f.trim()) ?? [],
    rulesPath: flag("--rules") ?? ".rules.yaml",
    cwd: resolve(flag("--cwd") ?? "."),
    provider: flag("--provider") as Provider | undefined,
    model: flag("--model"),
  };
}

async function main() {
  const { task, files, rulesPath, cwd, provider, model } = parseArgs(process.argv);

  const llmInfo = createLLMClient({ provider, model });
  const fullRulesPath = resolve(cwd, rulesPath);

  let rules: import("./types.js").Rule[] = [];
  if (existsSync(fullRulesPath)) {
    rules = loadRules(fullRulesPath);
  } else {
    // If no rules file found, default to empty list in interactive mode
    if (task) {
      console.warn(chalk.yellow(`[warning] Rules file not found at ${rulesPath}. Running without custom rules.`));
    }
  }

  // Interactive mode when no one-shot --task is specified
  if (!task) {
    await startInteractiveSession({
      rules,
      cwd,
      llmInfo,
      initialFiles: files,
    });
    return;
  }

  // One-shot mode (CLI execution)
  console.log(`[ironclad] task: ${task}`);
  console.log(`[ironclad] declared scope: ${files.length ? files.join(", ") : "(all)"}`);
  console.log(`[ironclad] loaded ${rules.length} rule(s)`);

  const engine = new RuleEngine(rules, cwd, { retryBudget: 3 });
  const spinner = ora({ text: "Processing...", color: "cyan" }).start();

  const result = await runAgent(task, files, engine, llmInfo.client, {
    cwd,
    rules,
    llm: llmInfo.client,
    events: {
      onTurnStart: (turn) => {
        spinner.text = `Turn ${turn}...`;
      },
      onAssistantMessage: (text) => {
        spinner.stop();
        printAssistantMessage(text);
        spinner.start();
      },
      onToolCall: (name, input) => {
        spinner.stop();
        printToolCall(name, input);
        spinner.start();
      },
      onToolApplied: (name, detail) => {
        spinner.stop();
        printToolApplied(detail);
        spinner.start();
      },
      onToolRejected: (name, violations) => {
        spinner.stop();
        printToolRejected(violations);
        spinner.start();
      },
      onToolError: (name, err) => {
        spinner.stop();
        printToolError(err);
        spinner.start();
      },
    },
  });

  spinner.stop();

  if (result.status === "complete") {
    printTaskDone(result.summary ?? "Done.");
  } else if (result.status === "escalated") {
    printEscalation(result.rule ?? "unknown");
    process.exitCode = 1;
  } else {
    console.log(chalk.yellow(`\n  ⚠  run status: ${result.status}\n`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(chalk.red("\nError:"), err instanceof Error ? err.message : err);
  process.exit(1);
});
