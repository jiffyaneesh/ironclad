import * as readline from "node:readline";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import { BUILTIN_COMMANDS, CommandSuggestion, getSuggestions } from "./suggestions.js";

/**
 * Real-time interactive prompt with live popover suggestions as you type.
 * Supports:
 * - Live suggestion popup beneath prompt on typing `/`
 * - Up/Down arrow navigation through commands
 * - Tab to auto-complete selected command
 * - Enter to submit line
 * - Backspace / typing characters in real-time
 */
export async function promptWithLiveSuggestions(promptText: string): Promise<string> {
  return new Promise<string>((resolve) => {
    let inputBuffer = "";
    let cursorIndex = 0;
    let selectedIndex = 0;
    let activeSuggestions: CommandSuggestion[] = [];
    let lastRenderedLines = 0;

    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(stdin);

    const cleanup = () => {
      stdin.removeListener("keypress", onKeypress);
      if (stdin.setRawMode) {
        stdin.setRawMode(wasRaw ?? false);
      }
    };

    const clearPreviousRender = () => {
      if (lastRenderedLines > 0) {
        // Move down to the end of the suggestion box and clear upwards
        for (let i = 0; i < lastRenderedLines; i++) {
          stdout.write("\x1b[1B\x1b[2K");
        }
        // Move back up to the prompt line
        stdout.write(`\x1b[${lastRenderedLines}A`);
        lastRenderedLines = 0;
      }
    };

    const render = () => {
      clearPreviousRender();

      // Clear the prompt line and reprint prompt + input
      stdout.write("\r\x1b[2K");
      stdout.write(promptText + inputBuffer);

      // Check if we should display live suggestions
      if (inputBuffer.startsWith("/")) {
        activeSuggestions = getSuggestions(inputBuffer);
      } else {
        activeSuggestions = [];
      }

      if (activeSuggestions.length > 0) {
        if (selectedIndex >= activeSuggestions.length) {
          selectedIndex = 0;
        }

        const lines: string[] = [];
        lines.push(chalk.hex("#7F8C8D")("  ╭── Commands (↑/↓ to navigate, Tab to select) ───────────╮"));

        activeSuggestions.forEach((s, idx) => {
          const isSelected = idx === selectedIndex;
          const marker = isSelected ? chalk.hex("#E74C3C").bold("❯") : " ";
          const cmd = isSelected
            ? chalk.bgHex("#C0392B").white.bold(` ${s.command.padEnd(20)} `)
            : chalk.hex("#E74C3C").bold(s.command.padEnd(22));
          const desc = chalk.hex("#BDC3C7")(s.description);
          lines.push(`  │ ${marker} ${cmd} ${desc}`);
        });

        lines.push(chalk.hex("#7F8C8D")("  ╰────────────────────────────────────────────────────────╯"));

        // Render suggestion box below the prompt line
        stdout.write("\n" + lines.join("\n"));
        lastRenderedLines = lines.length;

        // Move cursor back up to the prompt line and position it correctly
        stdout.write(`\x1b[${lastRenderedLines}A`);
      }

      // Reposition cursor horizontally on the prompt line
      const promptVisibleLength = promptText.replace(/\x1b\[[0-9;]*m/g, "").length;
      stdout.write(`\r\x1b[${promptVisibleLength + cursorIndex}C`);
    };

    const onKeypress = (str: string, key: readline.Key) => {
      // Ctrl+C to cancel
      if (key.ctrl && key.name === "c") {
        clearPreviousRender();
        stdout.write("\n");
        cleanup();
        process.exit(0);
      }

      // Enter key -> submit line
      if (key.name === "return") {
        clearPreviousRender();
        stdout.write("\n");
        cleanup();
        resolve(inputBuffer);
        return;
      }

      // Up arrow -> select previous suggestion
      if (key.name === "up" && activeSuggestions.length > 0) {
        selectedIndex = (selectedIndex - 1 + activeSuggestions.length) % activeSuggestions.length;
        render();
        return;
      }

      // Down arrow -> select next suggestion
      if (key.name === "down" && activeSuggestions.length > 0) {
        selectedIndex = (selectedIndex + 1) % activeSuggestions.length;
        render();
        return;
      }

      // Tab -> apply currently selected suggestion
      if (key.name === "tab") {
        if (activeSuggestions.length > 0) {
          const chosen = activeSuggestions[selectedIndex];
          inputBuffer = chosen.command;
          cursorIndex = inputBuffer.length;
          activeSuggestions = [];
        }
        render();
        return;
      }

      // Backspace
      if (key.name === "backspace") {
        if (cursorIndex > 0) {
          inputBuffer = inputBuffer.slice(0, cursorIndex - 1) + inputBuffer.slice(cursorIndex);
          cursorIndex--;
        }
        render();
        return;
      }

      // Left arrow
      if (key.name === "left") {
        if (cursorIndex > 0) cursorIndex--;
        render();
        return;
      }

      // Right arrow
      if (key.name === "right") {
        if (cursorIndex < inputBuffer.length) cursorIndex++;
        render();
        return;
      }

      // Regular character typed
      if (str && !key.ctrl && !key.meta) {
        inputBuffer = inputBuffer.slice(0, cursorIndex) + str + inputBuffer.slice(cursorIndex);
        cursorIndex += str.length;
        render();
      }
    };

    stdin.on("keypress", onKeypress);
    render();
  });
}
