/**
 * Extract the complete elements of a top-level array (e.g. "sections") from a
 * JSON document that is still streaming in. Elements that have not finished
 * arriving are ignored. Lets the UI show sections as soon as each one closes.
 */
export function completedArrayItems(partial: string, key: string): unknown[] {
  const keyAt = partial.indexOf(`"${key}"`);
  if (keyAt < 0) return [];
  const open = partial.indexOf("[", keyAt);
  if (open < 0) return [];

  const items: unknown[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let i = open + 1; i < partial.length; i++) {
    const ch = partial[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" || ch === "]") {
      if (depth === 0) break; // end of the array itself
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          items.push(JSON.parse(partial.slice(start, i + 1)));
        } catch {
          // malformed element; the full check will report it
        }
        start = -1;
      }
    }
  }
  return items;
}
