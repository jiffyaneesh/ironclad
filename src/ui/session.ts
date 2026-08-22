import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import ora from "ora";
import chalk from "chalk";
import type { Rule } from "../types.js";
import { RuleEngine } from "../engine.js";
import { runAgent } from "../agent.js";
import type { ResolvedLLMClient } from "../llm/index.js";
import type { LLMMessage } from "../llm/types.js";
import {
  printBanner,
  printRules,
  printAssistantMessage,
  printToolCall,
  printToolApplied,
  printToolRejected,
  printToolError,
  printEscalation,
} from "./printer.js";

export interface SessionOptions {
  rules: Rule[];
  cwd: string;
  llmInfo: ResolvedLLMClient;
  initialFiles?: string[];
}

export async function startInteractiveSession(opts: SessionOptions) {
  const { rules, cwd, llmInfo } = opts;
  let declaredFiles = opts.initialFiles ?? [];
  let history: LLMMessage[] = [];

  printBanner(llmInfo.provider, llmInfo.model, cwd, rules.length);

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const promptText = `${chalk.cyan.bold("ironclad")}${
        declaredFiles.length ? chalk.dim(` [${declaredFiles.join(",")}]`) : ""
      } ${chalk.green("❯")} `;

      const line = await rl.question(promptText);
      const trimmed = line.trim();

      if (!trimmed) continue;

      if (trimmed === "/exit" || trimmed === "/quit" || trimmed === "exit") {
        console.log(chalk.dim("Goodbye!"));
        break;
      }

      if (trimmed === "/rules") {
        printRules(rules);
        continue;
      }

      if (trimmed === "/clear") {
        history = [];
        console.log(chalk.dim("Conversation cleared.\n"));
        continue;
      }

      if (trimmed.startsWith("/scope")) {
        const parts = trimmed.slice(6).trim();
        if (!parts) {
          console.log(
            chalk.dim(
              `Current scope: ${
                declaredFiles.length ? declaredFiles.join(", ") : "(none)"
              }`
            )
          );
        } else {
          declaredFiles = parts.split(",").map((s) => s.trim());
          console.log(chalk.green(`Scope updated: ${declaredFiles.join(", ")}\n`));
        }
        continue;
      }

      // Execute agent loop for user's prompt
      const engine = new RuleEngine(rules, cwd, { retryBudget: 3 });
      const spinner = ora({
        text: "Thinking...",
        color: "cyan",
      });

      console.log();
      spinner.start();

      const result = await runAgent(trimmed, declaredFiles, engine, llmInfo.client, {
        cwd,
        history,
        events: {
          onTurnStart: (turn) => {
            spinner.text = `Turn ${turn} — reasoning...`;
          },
          onAssistantMessage: (text) => {
            spinner.stop();
            printAssistantMessage(text);
            spinner.start();
          },
          onToolCall: (name, toolInput) => {
            spinner.stop();
            printToolCall(name, toolInput);
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
      history = result.history;

      if (result.status === "complete") {
        console.log(chalk.bold.green(`\n✔ ${result.summary ?? "Done."}\n`));
      } else if (result.status === "escalated") {
        printEscalation(result.rule ?? "unknown");
      } else if (result.status === "max_turns_reached") {
        console.log(chalk.yellow("\nReached turn limit for this task.\n"));
      }
    }
  } finally {
    rl.close();
  }
}
