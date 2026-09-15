/**
 * Pure JSON extraction + repair stages for LLM output.
 * Dependency-free on purpose: unit-tested without sqlite or network.
 */

function stripFences(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return m ? m[1].trim() : s;
}

function removeTrailingCommas(s: string): string {
  return s.replace(/,\s*([}\]])/g, "$1");
}

/** Close unbalanced brackets/braces (truncated completions). String-aware. */
function autoClose(s: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      const open = stack[stack.length - 1];
      if ((ch === "}" && open === "{") || (ch === "]" && open === "[")) stack.pop();
    }
  }
  let out = s;
  if (inStr) out += '"';
  while (stack.length > 0) out += stack.pop() === "{" ? "}" : "]";
  return out;
}

/**
 * Detect degenerate repetition loops, e.g. `"Candidates": 1,` x200 —
 * the model stuck echoing one line. Conservative: needs 12+ lines with
 * one line dominating 80%+, so pretty-printed valid JSON never trips it.
 */
export function isRepetitionLoop(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 12) return false;
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
  let top = 0;
  for (const n of counts.values()) top = Math.max(top, n);
  return top / lines.length > 0.8;
}

/**
 * Try successive extraction/repair stages; return the first that parses.
 */
export function extractJson(text: string): { value: unknown; stage: string } | null {
  const t = text.trim();
  if (!t) return null;
  const stages: [string, () => string][] = [
    ["strict", () => t],
    ["fences", () => stripFences(t)],
    ["repair-commas", () => removeTrailingCommas(stripFences(t))],
    ["repair-truncated", () => autoClose(removeTrailingCommas(stripFences(t)))],
  ];
  for (const [stage, make] of stages) {
    const src = make();
    try {
      return { value: JSON.parse(src), stage };
    } catch { /* next stage */ }
    // Brace/bracket substring extraction as a sub-stage.
    const m = src.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) {
      try {
        return { value: JSON.parse(m[0]), stage: `${stage}+extract` };
      } catch {
        try {
          return { value: JSON.parse(autoClose(removeTrailingCommas(m[0]))), stage: `${stage}+extract+repair` };
        } catch { /* next stage */ }
      }
    }
  }
  return null;
}
