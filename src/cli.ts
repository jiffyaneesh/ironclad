#!/usr/bin/env node
import { resolve } from "node:path";
import { loadRules } from "./ruleLoader.js";
import { RuleEngine } from "./engine.js";
import { runAgent } from "./agent.js";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const taskIdx = args.indexOf("--task");
  const filesIdx = args.indexOf("--files");
  const rulesIdx = args.indexOf("--rules");
  const cwdIdx = args.indexOf("--cwd");

  const task = taskIdx >= 0 ? args[taskIdx + 1] : args[0];
  if (!task) {
    console.error(
      'Usage: rule-harness --task "fix the bug in auth.ts" --files auth.ts [--rules .rules.yaml] [--cwd .]'
    );
    process.exit(1);
  }

  return {
    task,
    files: filesIdx >= 0 ? args[filesIdx + 1].split(",").map((f) => f.trim()) : [],
    rulesPath: rulesIdx >= 0 ? args[rulesIdx + 1] : ".rules.yaml",
    cwd: resolve(cwdIdx >= 0 ? args[cwdIdx + 1] : "."),
  };
}

async function main() {
  const { task, files, rulesPath, cwd } = parseArgs(process.argv);

  console.log(`[harness] task: ${task}`);
  console.log(`[harness] declared scope: ${files.length ? files.join(", ") : "(none)"}`);
  console.log(`[harness] rules: ${rulesPath}`);

  const rules = loadRules(resolve(cwd, rulesPath));
  console.log(`[harness] loaded ${rules.length} rule(s): ${rules.map((r) => r.id).join(", ")}\n`);

  const engine = new RuleEngine(rules, cwd, { retryBudget: 3 });
  const result = await runAgent(task, files, engine, { cwd });

  console.log(`\n[harness] run finished: ${result.status}`);
  if (result.status !== "complete") process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
