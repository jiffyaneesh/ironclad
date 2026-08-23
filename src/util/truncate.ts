/**
 * Output truncation utility to prevent large outputs from blowing the LLM context.
 * Retains beginning and end of output with a clear truncation marker.
 */

export interface TruncateOptions {
  maxLines?: number;
  maxChars?: number;
}

export interface TruncateResult {
  content: string;
  truncated: boolean;
  totalLines: number;
}

export function truncateOutput(
  text: string,
  options: TruncateOptions = {}
): TruncateResult {
  const maxLines = options.maxLines ?? 250;
  const maxChars = options.maxChars ?? 25_000;

  const normalized = text.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const totalLines = lines.length;

  if (totalLines <= maxLines && normalized.length <= maxChars) {
    return { content: normalized, truncated: false, totalLines };
  }

  // If truncated by lines, take head + tail
  const headLines = Math.floor(maxLines * 0.6);
  const tailLines = Math.floor(maxLines * 0.3);
  const omitted = totalLines - (headLines + tailLines);

  const head = lines.slice(0, headLines).join("\n");
  const tail = lines.slice(-tailLines).join("\n");

  const marker = `\n\n... [${omitted} lines truncated for context budget] ...\n\n`;
  let combined = head + marker + tail;

  // If still exceeds maxChars, do a hard slice
  if (combined.length > maxChars) {
    combined = combined.slice(0, maxChars) + "\n... [content truncated]";
  }

  return {
    content: combined,
    truncated: true,
    totalLines,
  };
}
