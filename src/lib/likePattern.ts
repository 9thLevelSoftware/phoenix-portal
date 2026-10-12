/**
 * Escape `%`, `_`, and `\` so a search string matches those characters
 * literally inside a SQL LIKE / ILIKE pattern. Postgres uses `\` as the
 * default LIKE escape character.
 */
export function escapeLikeWildcards(value: string): string {
	return value.replace(/[%_\\]/g, "\\$&");
}
