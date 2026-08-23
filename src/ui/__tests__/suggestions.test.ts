import { describe, it, expect } from "vitest";
import { getSuggestions, completer, BUILTIN_COMMANDS } from "../suggestions.js";

describe("Command suggestions & autocompletion", () => {
  it("returns all commands when / is typed", () => {
    const suggestions = getSuggestions("/");
    expect(suggestions.length).toBe(BUILTIN_COMMANDS.length);
  });

  it("filters suggestions by prefix", () => {
    const suggestions = getSuggestions("/ru");
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((s) => s.command.startsWith("/ru"))).toBe(true);
  });

  it("returns empty array for regular non-slash user prompts", () => {
    const suggestions = getSuggestions("fix the bug in auth.ts");
    expect(suggestions).toEqual([]);
  });

  it("completer provides tab completion candidates", () => {
    const [hits] = completer("/sk");
    expect(hits).toContain("/skills");
    expect(hits).toContain("/skills add");
  });
});
