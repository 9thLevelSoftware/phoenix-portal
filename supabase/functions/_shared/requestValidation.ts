export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonResponse(
	body: unknown,
	status: number,
	cors: Record<string, string>,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...cors, "Content-Type": "application/json" },
	});
}

export async function readJsonObject(
	req: Request,
	cors: Record<string, string>,
	errorBody: unknown = { error: "Invalid JSON body" },
): Promise<{ ok: true; data: JsonObject } | { ok: false; response: Response }> {
	let parsed: unknown;

	try {
		parsed = await req.json();
	} catch {
		return { ok: false, response: jsonResponse(errorBody, 400, cors) };
	}

	if (!isJsonObject(parsed)) {
		return { ok: false, response: jsonResponse(errorBody, 400, cors) };
	}

	return { ok: true, data: parsed };
}
