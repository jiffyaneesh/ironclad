import { describe, it, expect } from "vitest";
import { getSuggestions, BUILTIN_COMMANDS, type CommandSuggestion } from "../suggestions.js";

describe("High-value slash command registry", () => {
  it("includes /commit, /review, /undo, and /model in suggestions", () => {
    const cmds = BUILTIN_COMMANDS.map((c: CommandSuggestion) => c.command);
    expect(cmds).toContain("/commit");
    expect(cmds).toContain("/review");
    expect(cmds).toContain("/undo");
    expect(cmds).toContain("/model");
  });

  it("filters suggestions for /c", () => {
    const matches = getSuggestions("/c");
    const cmds = matches.map((m: CommandSuggestion) => m.command);
    expect(cmds).toContain("/commit");
    expect(cmds).toContain("/clear");
  });

  it("filters suggestions for /m", () => {
    const matches = getSuggestions("/m");
    const cmds = matches.map((m: CommandSuggestion) => m.command);
    expect(cmds).toContain("/model");
  });
});
