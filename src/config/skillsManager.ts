import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { GLOBAL_SKILLS_DIR, workspaceSkillsDir } from "./paths.js";

export type SkillScope = "workspace" | "global";

export interface Skill {
  name: string;
  scope: SkillScope;
  path: string;
  content: string;
}

const SKILL_TEMPLATE = (name: string) =>
  `# ${name}\n\n<!-- Describe context, conventions, or instructions for this skill. -->\n<!-- The agent reads this on every task in this scope. -->\n\n`;

/** Lists all skills from workspace (.ironclad/skills) then global (~/.ironclad/skills). */
export function listSkills(cwd: string): Skill[] {
  const sources: Array<[SkillScope, string]> = [
    ["workspace", workspaceSkillsDir(cwd)],
    ["global", GLOBAL_SKILLS_DIR],
  ];
  return sources.flatMap(([scope, dir]) => readSkillsFrom(scope, dir));
}

function readSkillsFrom(scope: SkillScope, dir: string): Skill[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const path = join(dir, f);
      return { name: basename(f, ".md"), scope, path, content: readFileSync(path, "utf-8") };
    });
}

/** Creates the skill markdown file and returns its path. */
export function createSkill(name: string, scope: SkillScope, cwd: string): string {
  const dir = scope === "workspace" ? workspaceSkillsDir(cwd) : GLOBAL_SKILLS_DIR;
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.md`);
  if (!existsSync(path)) writeFileSync(path, SKILL_TEMPLATE(name), "utf-8");
  return path;
}

/** Builds the skills block injected into the agent system prompt. */
export function buildSkillsPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const sections = skills.map((s) => `### Skill: ${s.name} (${s.scope})\n${s.content.trim()}`);
  return `\n\n--- Active Skills & Context ---\n${sections.join("\n\n")}`;
}
