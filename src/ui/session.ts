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
  clearScreen,
  printBanner,
  printRules,
  printAssistantMessage,
  printToolCall,
  printToolApplied,
  printToolRejected,
  printToolError,
  printTaskDone,
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

  clearScreen();
  printBanner(llmInfo.provider, llmInfo.model, cwd, rules.length);

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const scope = declaredFiles.length
        ? chalk.hex("#7F8C8D")(` [${declaredFiles.join(",")}]`)
        : "";
      const promptText = `${chalk.hex("#C0392B").bold("ironclad")}${scope} ${chalk.hex("#E74C3C")("›")} `;

      const line = await rl.question(promptText);
      const trimmed = line.trim();

      if (!trimmed) continue;

      if (trimmed === "/exit" || trimmed === "/quit" || trimmed === "exit") {
        console.log(chalk.hex("#7F8C8D")("\n  Goodbye.\n"));
        break;
      }

      if (trimmed === "/rules") {
        printRules(rules);
        continue;
      }

      if (trimmed === "/clear") {
        history = [];
        clearScreen();
        printBanner(llmInfo.provider, llmInfo.model, cwd, rules.length);
        continue;
      }

      if (trimmed.startsWith("/scope")) {
        const parts = trimmed.slice(6).trim();
        if (!parts) {
          const current = declaredFiles.length ? declaredFiles.join(", ") : "(none — all files allowed)";
          console.log(chalk.hex("#7F8C8D")(`\n  scope: ${current}\n`));
        } else {
          declaredFiles = parts.split(",").map((s) => s.trim());
          console.log(chalk.hex("#E74C3C")(`\n  ✔  Scope set: ${declaredFiles.join(", ")}\n`));
        }
        continue;
      }

      // ── Run agent ───────────────────────────────────────────────────────
      const engine = new RuleEngine(rules, cwd, { retryBudget: 3 });
      const spinner = ora({
        prefixText: "  ",
        color: "red",
        spinner: "dots",
      });

      console.log();
      spinner.start(chalk.hex("#95A5A6")("Thinking…"));

      const result = await runAgent(trimmed, declaredFiles, engine, llmInfo.client, {
        cwd,
        history,
        events: {
          onTurnStart: (turn) => {
            spinner.text = chalk.hex("#95A5A6")(`Turn ${turn}  —  reasoning…`);
          },
          onAssistantMessage: (text) => {
            spinner.stop();
            printAssistantMessage(text);
          },
          onToolCall: (name, toolInput) => {
            spinner.stop();
            printToolCall(name, toolInput);
            spinner.start(chalk.hex("#95A5A6")("…"));
          },
          onToolApplied: (_name, detail) => {
            spinner.stop();
            printToolApplied(detail);
            spinner.start(chalk.hex("#95A5A6")("…"));
          },
          onToolRejected: (_name, violations) => {
            spinner.stop();
            printToolRejected(violations);
            spinner.start(chalk.hex("#95A5A6")("Retrying…"));
          },
          onToolError: (_name, err) => {
            spinner.stop();
            printToolError(err);
            spinner.start(chalk.hex("#95A5A6")("…"));
          },
        },
      });

      spinner.stop();
      history = result.history;

      if (result.status === "complete") {
        printTaskDone(result.summary ?? "Done.");
      } else if (result.status === "escalated") {
        printEscalation(result.rule ?? "unknown");
      } else if (result.status === "max_turns_reached") {
        console.log(chalk.yellow("\n  ⚠  Turn limit reached — task may be incomplete.\n"));
      }
    }
  } finally {
    rl.close();
  }
}
