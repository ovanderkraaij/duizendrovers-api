// Backtick-quote an identifier (e.g., column or table)
export function qid(id: string) {
    // allow only alnum + underscore to prevent injection; then wrap in backticks
    if (!/^[A-Za-z0-9_]+$/.test(id)) throw new Error(`Invalid identifier: ${id}`);
    return `\`${id}\``;
}

// Build "?, ?, ?" placeholder list
export function placeholders(n: number) {
    return Array.from({ length: n }, () => "?").join(",");
}