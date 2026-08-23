import { homedir } from "node:os";
import { join } from "node:path";

/** Global config dir: ~/.ironclad/ */
export const GLOBAL_DIR       = join(homedir(), ".ironclad");
export const GLOBAL_RULES     = join(GLOBAL_DIR, "rules.yaml");
export const GLOBAL_SKILLS_DIR = join(GLOBAL_DIR, "skills");

/** Workspace-scoped paths (relative to the cwd being worked on) */
export const workspaceRules     = (cwd: string) => join(cwd, ".rules.yaml");
export const workspaceSkillsDir = (cwd: string) => join(cwd, ".ironclad", "skills");
