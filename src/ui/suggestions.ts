import chalk from "chalk";

export interface CommandSuggestion {
  command: string;
  description: string;
  example?: string;
}

export const BUILTIN_COMMANDS: CommandSuggestion[] = [
  { command: "/rules", description: "List all active rules (workspace & global)" },
  { command: "/rules add", description: "Launch interactive wizard to create a new rule" },
  { command: "/skills", description: "List loaded skills and context guidelines" },
  { command: "/skills add", description: "Create a workspace-scoped skill file and open in $EDITOR" },
  { command: "/skills add global", description: "Create a global skill in ~/.ironclad/skills/" },
  { command: "/skills reload", description: "Hot-reload skills from disk" },
  { command: "/scope", description: "Set or inspect declared file scope (e.g. /scope src/cli.ts)" },
  { command: "/commit", description: "Verify rule gates and make a git commit" },
  { command: "/review", description: "Audit uncommitted changes against active rules" },
  { command: "/undo", description: "Revert uncommitted changes in working directory" },
  { command: "/model", description: "Switch LLM provider/model (e.g. /model openai gpt-4o)" },
  { command: "/delegate", description: "Spawn a dedicated subagent for a focused subtask" },
  { command: "/clear", description: "Clear conversation history & reset terminal" },
  { command: "/exit", description: "Exit Ironclad session" },
];

export function getSuggestions(input: string): CommandSuggestion[] {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return [];
  }

  return BUILTIN_COMMANDS.filter((item) =>
    item.command.toLowerCase().startsWith(trimmed.toLowerCase())
  );
}

export function formatSuggestions(suggestions: CommandSuggestion[]): string {
  if (suggestions.length === 0) return "";

  const lines = [
    chalk.hex("#7F8C8D")("  ╭── Available Commands ──────────────────────────────────╮"),
  ];

  for (const s of suggestions) {
    const cmd = chalk.hex("#E74C3C").bold(s.command.padEnd(20));
    const desc = chalk.hex("#BDC3C7")(s.description);
    lines.push(`  │  ${cmd} ${desc}`);
  }

  lines.push(chalk.hex("#7F8C8D")("  ╰────────────────────────────────────────────────────────╯"));
  return lines.join("\n");
}

export function completer(line: string): [string[], string] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) {
    return [[], line];
  }

  const hits = BUILTIN_COMMANDS.filter((c) =>
    c.command.toLowerCase().startsWith(trimmed.toLowerCase())
  ).map((c) => c.command);

  return [hits.length ? hits : [], line];
}
