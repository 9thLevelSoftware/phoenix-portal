const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/;

export function sanitizeCSVFormula(value: string): string {
	return FORMULA_PREFIX_PATTERN.test(value) ? `'${value}` : value;
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
