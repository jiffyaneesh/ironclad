#!/usr/bin/env node
import { resolve } from "node:path";
import { loadRules } from "./ruleLoader.js";
import { RuleEngine } from "./engine.js";
import { runAgent } from "./agent.js";
import { createLLMClient, type Provider } from "./llm/index.js";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);

  function flag(name: string): string | undefined {
    const idx = args.indexOf(name);
    return idx >= 0 ? args[idx + 1] : undefined;
  }

  const task = flag("--task") ?? args[0];
  if (!task) {
    console.error(
      [
        "Usage: ironclad --task \"fix the bug in auth.ts\" --files auth.ts",
        "                [--rules .rules.yaml] [--cwd .]",
        "                [--provider anthropic|openai|gemini] [--model <model-name>]",
        "",
        "Provider is auto-detected from env if not set:",
        "  ANTHROPIC_API_KEY  →  anthropic  (default model: claude-opus-4-5)",
        "  OPENAI_API_KEY     →  openai     (default model: gpt-4o)",
        "  GEMINI_API_KEY     →  gemini     (default model: gemini-2.0-flash)",
      ].join("\n")
    );
    process.exit(1);
  }

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

  const llm = createLLMClient({ provider, model });

  console.log(`[harness] task: ${task}`);
  console.log(`[harness] declared scope: ${files.length ? files.join(", ") : "(none)"}`);
  console.log(`[harness] rules: ${rulesPath}`);

  const rules = loadRules(resolve(cwd, rulesPath));
  console.log(`[harness] loaded ${rules.length} rule(s): ${rules.map((r) => r.id).join(", ")}\n`);

  const engine = new RuleEngine(rules, cwd, { retryBudget: 3 });
  const result = await runAgent(task, files, engine, llm, { cwd });

  console.log(`\n[harness] run finished: ${result.status}`);
  if (result.status !== "complete") process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
