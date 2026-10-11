/**
 * Quote Mermaid node labels that contain nested [id] path params.
 * Parallelogram nodes like API_Agent[/api/agent/[id]/] otherwise parse as
 * nested square-bracket shapes and throw a Syntax/Parse error in the page.
 *
 * @param {string} source
 * @returns {string}
 */
export function sanitizeMermaidSource(source) {
  return String(source ?? "")
    .split("\n")
    .map(sanitizeMermaidLine)
    .join("\n");
}

function quoteLabel(label) {
  const trimmed = String(label).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed;
  }
  return `"${trimmed.replace(/"/g, "#quot;")}"`;
}

function sanitizeMermaidLine(line) {
  if (/^\s*%%/.test(line)) return line;

  let next = line.replace(/\b([A-Za-z][\w]*)\[(\/.*\/|\\.*\\)\]/g, (match, id, label) => {
    if (!/\[[^\]]+\]/.test(label)) return match;
    return `${id}[${quoteLabel(label)}]`;
  });

  next = next.replace(
    /\b([A-Za-z][\w]*)\[([^\]"]*\[[^\]]+\][^\]]*)\]/g,
    (_, id, label) => `${id}[${quoteLabel(label)}]`,
  );

  next = next.replace(
    /^(\s*participant\s+\S+\s+as\s+)([^"'\n]+)$/i,
    (match, prefix, alias) => (alias.includes("[") ? `${prefix}${quoteLabel(alias)}` : match),
  );

  return next;
}
