/**
 * FTS5 treats punctuation as syntax, so every token is quoted and prefix
 * matched: `inv` finds "invoice" without letting a user inject operators.
 *
 * Kept free of server imports so the rules can be unit tested directly.
 */
export function toMatchQuery(query: string) {
  const tokens = query
    .split(/\s+/)
    .map((token) => token.replace(/["*^:()]/g, "").trim())
    .filter(Boolean)
    .slice(0, 8);

  return tokens.map((token) => `"${token}"*`).join(" AND ");
}
