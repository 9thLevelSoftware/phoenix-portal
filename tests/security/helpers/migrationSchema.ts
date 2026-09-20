/**
 * Minimal parser for supabase/migrations/*.sql, used by the R-31 manifest
 * test. It tracks public tables, their columns, NOT NULL columns, primary
 * key / unique column sets and foreign keys (with ON DELETE action).
 *
 * Handled: CREATE TABLE; ALTER TABLE ADD COLUMN / ADD [CONSTRAINT] FOREIGN
 * KEY / PRIMARY KEY / UNIQUE, DROP CONSTRAINT, DROP COLUMN, ALTER COLUMN
 * SET/DROP NOT NULL; DROP TABLE; CREATE UNIQUE INDEX (non-partial).
 * DDL inside `DO $tag$ ... $tag$` blocks is parsed too (the idempotent
 * migration pattern); function bodies are ignored. `EXECUTE '...'` strings
 * are not parsed (string literals are blanked).
 */

export interface ForeignKey {
	name: string;
	columns: string[];
	/** schema-qualified, e.g. `auth.users` or `public.routines` */
	ref: string;
	onDelete: string;
}

export interface ParsedTable {
	columns: Set<string>;
	notNull: Set<string>;
	/** PRIMARY KEY and UNIQUE column sets (constraint name -> columns) */
	uniques: Map<string, string[]>;
	fks: ForeignKey[];
}

export type Schema = Map<string, ParsedTable>;

const IDENT = String.raw`"?(\w+)"?`;
const QUALIFIED = String.raw`(?:"?(\w+)"?\.)?"?(\w+)"?`;

/**
 * Removes comments, string literals and function bodies. Keeps the bodies of
 * DO blocks so the DDL inside them is parsed.
 */
export function stripSql(sql: string): string {
	return sql
		.replace(
			/\$(\w*)\$([\s\S]*?)\$\1\$/g,
			(_match, _tag: string, body: string, offset: number, whole: string) =>
				/\bdo\s*$/i.test(whole.slice(Math.max(0, offset - 20), offset))
					? ` ${body} ;`
					: "''",
		)
		.replace(/--[^\n]*/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/'(?:[^']|'')*'/g, "''");
}

function norm(name: string): string {
	return name.toLowerCase();
}

function splitTopLevel(body: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	for (const ch of body) {
		if (ch === "(") depth++;
		if (ch === ")") depth--;
		if (ch === "," && depth === 0) {
			parts.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	if (current.trim()) parts.push(current);
	return parts.map((part) => part.trim());
}

function parseReference(
	clause: string,
): { ref: string; onDelete: string } | null {
	const match = new RegExp(String.raw`\breferences\s+${QUALIFIED}`, "i").exec(
		clause,
	);
	if (!match) return null;
	const onDelete =
		/\bon\s+delete\s+(cascade|set\s+null|set\s+default|restrict|no\s+action)/i
			.exec(clause)?.[1]
			.toLowerCase()
			.replace(/\s+/, " ") ?? "no action";
	return {
		ref: `${norm(match[1] ?? "public")}.${norm(match[2])}`,
		onDelete,
	};
}

function parseListColumns(list: string): string[] {
	return list.split(",").map((c) => norm(c.trim().replace(/"/g, "")));
}

function newTable(): ParsedTable {
	return {
		columns: new Set(),
		notNull: new Set(),
		uniques: new Map(),
		fks: [],
	};
}

function addUnique(
	table: ParsedTable,
	name: string,
	columns: string[],
	primary: boolean,
): void {
	table.uniques.set(name, columns);
	if (primary) for (const column of columns) table.notNull.add(column);
}

/** Handles one column definition or table constraint (CREATE or ALTER ADD). */
function applyElement(
	tableName: string,
	table: ParsedTable,
	element: string,
): void {
	const constraintName = new RegExp(`^constraint\\s+${IDENT}\\s+`, "i").exec(
		element,
	);
	const body = constraintName
		? element.slice(constraintName[0].length)
		: element;
	const named = constraintName ? norm(constraintName[1]) : null;

	const fk = /^foreign\s+key\s*\(([^)]*)\)/i.exec(body);
	if (fk) {
		const reference = parseReference(body);
		if (reference) {
			const columns = parseListColumns(fk[1]);
			table.fks.push({
				name: named ?? `${tableName}_${columns[0]}_fkey`,
				columns,
				...reference,
			});
		}
		return;
	}
	const key =
		/^(primary\s+key|unique)\s*(?:nulls\s+not\s+distinct\s*)?\(([^)]*)\)/i.exec(
			body,
		);
	if (key) {
		const primary = /^primary/i.test(key[1]);
		const columns = parseListColumns(key[2]);
		addUnique(
			table,
			named ??
				(primary
					? `${tableName}_pkey`
					: `${tableName}_${columns.join("_")}_key`),
			columns,
			primary,
		);
		return;
	}
	if (
		constraintName ||
		/^(primary|unique|check|exclude|like)\b/i.test(element)
	) {
		return;
	}
	const column = new RegExp(`^${IDENT}`).exec(element);
	if (!column) return;
	const name = norm(column[1]);
	table.columns.add(name);
	if (/\bnot\s+null\b/i.test(element)) table.notNull.add(name);
	if (/\bprimary\s+key\b/i.test(element)) {
		addUnique(table, `${tableName}_pkey`, [name], true);
	} else if (/\bunique\b/i.test(element)) {
		addUnique(table, `${tableName}_${name}_key`, [name], false);
	}
	const reference = parseReference(element);
	if (reference) {
		table.fks.push({
			name: `${tableName}_${name}_fkey`,
			columns: [name],
			...reference,
		});
	}
}

const DDL_START =
	/\b(create\s+(?:unlogged\s+)?table|alter\s+table|drop\s+table|create\s+unique\s+index)\b/i;

export function parseMigrations(sqlTexts: string[]): Schema {
	const schema: Schema = new Map();
	const createTable = new RegExp(
		String.raw`^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${QUALIFIED}\s*\(([\s\S]*)\)`,
		"i",
	);
	const alterTable = new RegExp(
		String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${QUALIFIED}\s+([\s\S]*)$`,
		"i",
	);
	const dropTable = new RegExp(
		String.raw`^drop\s+table\s+(?:if\s+exists\s+)?${QUALIFIED}`,
		"i",
	);
	const uniqueIndex = new RegExp(
		String.raw`^create\s+unique\s+index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?${IDENT}\s+on\s+(?:only\s+)?${QUALIFIED}\s*(?:using\s+\w+\s*)?\(([^()]*)\)\s*(where\b)?`,
		"i",
	);
	for (const text of sqlTexts) {
		for (const raw of stripSql(text).split(";")) {
			// Inside DO blocks the DDL follows IF ... THEN / BEGIN.
			const start = DDL_START.exec(raw);
			if (!start) continue;
			const statement = raw.slice(start.index).trim();
			let match = createTable.exec(statement);
			if (match) {
				if (match[1] && norm(match[1]) !== "public") continue;
				const name = norm(match[2]);
				const table = schema.get(name) ?? newTable();
				schema.set(name, table);
				for (const element of splitTopLevel(match[3])) {
					applyElement(name, table, element);
				}
				continue;
			}
			match = alterTable.exec(statement);
			if (match) {
				if (match[1] && norm(match[1]) !== "public") continue;
				const tableName = norm(match[2]);
				const table = schema.get(tableName);
				if (!table) continue;
				for (const action of splitTopLevel(match[3])) {
					const add = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?/i.exec(
						action,
					);
					if (add) {
						applyElement(tableName, table, action.slice(add[0].length).trim());
						continue;
					}
					const dropConstraint = new RegExp(
						String.raw`^drop\s+constraint\s+(?:if\s+exists\s+)?${IDENT}`,
						"i",
					).exec(action);
					if (dropConstraint) {
						const constraint = norm(dropConstraint[1]);
						table.fks = table.fks.filter((fk) => fk.name !== constraint);
						table.uniques.delete(constraint);
						continue;
					}
					const notNull = new RegExp(
						String.raw`^alter\s+(?:column\s+)?${IDENT}\s+(set|drop)\s+not\s+null`,
						"i",
					).exec(action);
					if (notNull) {
						const column = norm(notNull[1]);
						if (/set/i.test(notNull[2])) table.notNull.add(column);
						else table.notNull.delete(column);
						continue;
					}
					const drop = new RegExp(
						String.raw`^drop\s+column\s+(?:if\s+exists\s+)?${IDENT}`,
						"i",
					).exec(action);
					if (drop) {
						const column = norm(drop[1]);
						table.columns.delete(column);
						table.notNull.delete(column);
						table.fks = table.fks.filter((fk) => !fk.columns.includes(column));
						for (const [name, columns] of table.uniques) {
							if (columns.includes(column)) table.uniques.delete(name);
						}
					}
				}
				continue;
			}
			match = uniqueIndex.exec(statement);
			if (match) {
				if (match[5]) continue; // partial index: not a uniqueness guarantee
				if (match[2] && norm(match[2]) !== "public") continue;
				const table = schema.get(norm(match[3]));
				const columns = parseListColumns(match[4]);
				if (table && columns.every((c) => /^\w+$/.test(c))) {
					table.uniques.set(norm(match[1]), columns);
				}
				continue;
			}
			match = dropTable.exec(statement);
			if (match && (!match[1] || norm(match[1]) === "public")) {
				schema.delete(norm(match[2]));
			}
		}
	}
	return schema;
}

/** Row columns per table from the generated `src/lib/database.types.ts`. */
export function tableRowColumnsFromTypes(
	source: string,
): Map<string, Set<string>> {
	const start = source.indexOf("Tables: {");
	const end = source.indexOf("Views: {", start);
	const lines = source.slice(start, end).split("\n");
	const tables = new Map<string, Set<string>>();
	let current: string | null = null;
	let inRow = false;
	for (const line of lines) {
		const table = /^\t\t\t(\w+): \{$/.exec(line);
		if (table) {
			current = table[1];
			inRow = false;
			continue;
		}
		if (/^\t\t\t\tRow: \{$/.test(line)) inRow = true;
		else if (/^\t\t\t\t\}/.test(line)) inRow = false;
		else if (inRow && current) {
			const column = /^\t\t\t\t\t(\w+)\??:/.exec(line);
			if (column) {
				const columns = tables.get(current) ?? new Set<string>();
				columns.add(column[1]);
				tables.set(current, columns);
			}
		}
	}
	return tables;
}

/** table -> why it counts as user-owned */
export function discoverUserOwnedTables(
	schema: Schema,
	typeUserIdTables: Iterable<string> = [],
): Map<string, string> {
	const owned = new Map<string, string>();
	for (const [name, table] of schema) {
		if (table.columns.has("user_id")) owned.set(name, "user_id column");
		else if (table.fks.some((fk) => fk.ref === "auth.users")) {
			owned.set(name, "FK to auth.users");
		}
	}
	for (const name of typeUserIdTables) {
		if (!owned.has(name)) owned.set(name, "user_id in database.types.ts");
	}
	let changed = true;
	while (changed) {
		changed = false;
		for (const [name, table] of schema) {
			if (owned.has(name)) continue;
			const parent = table.fks.find(
				(fk) => fk.ref.startsWith("public.") && owned.has(fk.ref.slice(7)),
			);
			if (parent) {
				owned.set(name, `FK to ${parent.ref.slice(7)}`);
				changed = true;
			}
		}
	}
	return owned;
}
