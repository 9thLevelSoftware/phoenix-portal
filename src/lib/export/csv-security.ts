// Dangerous spreadsheet-formula prefixes: =, +, -, @, tab, CR, LF. Use a Set
// rather than a regex so the control-character escapes don't trip the linter.
const FORMULA_PREFIX_CHARS = new Set(["=", "+", "-", "@", "\t", "\r", "\n"]);

export function sanitizeCSVFormula(value: string): string {
	// Spreadsheet apps ignore leading spaces before evaluating a formula, so
	// " =SUM(...)" must be treated as a formula too. Strip only leading SPACES
	// (not tab/CR/LF, which are themselves dangerous prefixes we must detect).
	const trimmed = value.replace(/^ +/, "");
	return trimmed.length > 0 && FORMULA_PREFIX_CHARS.has(trimmed[0])
		? `'${value}`
		: value;
}

export function escapeCSVField(value: string): string {
	const sanitized = sanitizeCSVFormula(value);
	if (
		sanitized.includes(",") ||
		sanitized.includes('"') ||
		sanitized.includes("\n") ||
		sanitized.includes("\r")
	) {
		return `"${sanitized.replace(/"/g, '""')}"`;
	}
	return sanitized;
}
