import * as readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import ora from "ora";
import chalk from "chalk";
import type { Rule } from "../types.js";
import { RuleEngine } from "../engine.js";
import { runAgent } from "../agent.js";
import type { ResolvedLLMClient } from "../llm/index.js";
import type { LLMMessage } from "../llm/types.js";
import { loadRulesFile, mergeRules } from "../config/rulesManager.js";
import { listSkills, createSkill, buildSkillsPrompt } from "../config/skillsManager.js";
import type { Skill } from "../config/skillsManager.js";
import { workspaceRules, GLOBAL_RULES } from "../config/paths.js";
import { runRuleWizard } from "./ruleWizard.js";
import {
  clearScreen,
  printBanner,
  printRules,
  printSkills,
  printAssistantMessage,
  printToolCall,
  printToolApplied,
  printToolRejected,
  printToolError,
  printTaskDone,
  printEscalation,
} from "./printer.js";
import {
  completer,
  getSuggestions,
  formatSuggestions,
} from "./suggestions.js";

export interface SessionOptions {
  rules: Rule[];        // initial rules (already merged) passed from cli.ts
  cwd: string;
  llmInfo: ResolvedLLMClient;
  initialFiles?: string[];
}

// ── Internal state helpers ────────────────────────────────────────────────

function loadAllRules(cwd: string): { global: Rule[]; workspace: Rule[]; merged: Rule[] } {
  const globalR    = loadRulesFile(GLOBAL_RULES);
  const workspaceR = loadRulesFile(workspaceRules(cwd));
  return { global: globalR, workspace: workspaceR, merged: mergeRules(globalR, workspaceR) };
}

// ── Main session ──────────────────────────────────────────────────────────

export async function startInteractiveSession(opts: SessionOptions) {
  const { cwd, llmInfo } = opts;
  let declaredFiles = opts.initialFiles ?? [];
  let history: LLMMessage[] = [];

  let { global: globalRules, workspace: wsRules, merged: rules } = loadAllRules(cwd);
  let skills: Skill[] = listSkills(cwd);

  clearScreen();
  printBanner(llmInfo.provider, llmInfo.model, cwd, rules.length);

  const rl = readline.createInterface({
    input,
    output,
    completer,
    tabSize: 2,
  });

  try {
    while (true) {
      const scope = declaredFiles.length
        ? chalk.hex("#7F8C8D")(` [${declaredFiles.join(",")}]`)
        : "";
      const skillsBadge = skills.length > 0
        ? chalk.hex("#7F8C8D")(` +${skills.length}s`)
        : "";
      const prompt = `${chalk.hex("#C0392B").bold("ironclad")}${scope}${skillsBadge} ${chalk.hex("#E74C3C")("›")} `;

      const line = await rl.question(prompt);
      const trimmed = line.trim();

      if (!trimmed) continue;

      // ── Built-in commands ──────────────────────────────────────────────

      if (trimmed === "/exit" || trimmed === "/quit" || trimmed === "exit") {
        console.log(chalk.hex("#7F8C8D")("\n  Goodbye.\n"));
        break;
      }

      if (trimmed === "/clear") {
        history = [];
        clearScreen();
        printBanner(llmInfo.provider, llmInfo.model, cwd, rules.length);
        continue;
      }

      // ── /rules ────────────────────────────────────────────────────────

      if (trimmed === "/rules") {
        printRules(globalRules, wsRules);
        continue;
      }

      if (trimmed === "/rules add") {
        const added = await runRuleWizard(rl, cwd);
        if (added) {
          // hot-reload so the new rule is active immediately
          ({ global: globalRules, workspace: wsRules, merged: rules } = loadAllRules(cwd));
          console.log(chalk.hex("#E74C3C")(`  ↻  Rules reloaded (${rules.length} active)\n`));
        }
        continue;
      }

      // ── /scope ────────────────────────────────────────────────────────

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

      // ── /skills ───────────────────────────────────────────────────────

      if (trimmed === "/skills" || trimmed === "/skills list") {
        printSkills(skills);
        continue;
      }

      if (trimmed.startsWith("/skills add")) {
        const rest     = trimmed.slice(11).trim();
        const isGlobal = rest.startsWith("global ");
        const name     = (isGlobal ? rest.slice(7) : rest).trim().replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
        const scope    = isGlobal ? "global" : "workspace";

        if (!name) {
          console.log(chalk.dim("  Usage: /skills add <name>  or  /skills add global <name>\n"));
          continue;
        }

        const skillPath = createSkill(name, scope, cwd);
        console.log(chalk.dim(`  Opening ${skillPath} in $EDITOR…\n`));

        const editor = process.env.EDITOR ?? process.env.VISUAL ?? "nano";
        spawnSync(editor, [skillPath], { stdio: "inherit" });

        skills = listSkills(cwd);
        console.log(chalk.hex("#E74C3C")(`  ✔  Skill "${name}" loaded (${skills.length} active)\n`));
        continue;
      }

      if (trimmed === "/skills reload") {
        skills = listSkills(cwd);
        console.log(chalk.hex("#E74C3C")(`  ↻  Skills reloaded (${skills.length} active)\n`));
        continue;
      }

      if (trimmed === "/help" || trimmed === "/?") {
        const matches = getSuggestions("/");
        console.log("\n" + formatSuggestions(matches) + "\n");
        continue;
      }

      // If user typed an unknown slash command, show intellisense suggestions
      if (trimmed.startsWith("/")) {
        const matches = getSuggestions(trimmed);
        if (matches.length > 0) {
          console.log("\n" + formatSuggestions(matches) + "\n");
        } else {
          console.log(
            chalk.hex("#E74C3C")(
              `\n  Unknown command "${trimmed}". Type /help to see all available commands.\n`
            )
          );
        }
        continue;
      }

      // ── Run agent ─────────────────────────────────────────────────────

      const engine = new RuleEngine(rules, cwd, { retryBudget: 3 });
      const skillsContext = buildSkillsPrompt(skills);

      const spinner = ora({ prefixText: "  ", color: "red", spinner: "dots" });
      console.log();
      spinner.start(chalk.hex("#95A5A6")("Thinking…"));

      const result = await runAgent(trimmed, declaredFiles, engine, llmInfo.client, {
        cwd,
        history,
        systemExtra: skillsContext,
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
