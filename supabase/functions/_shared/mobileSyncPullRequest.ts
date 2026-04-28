import { isJsonObject } from "./requestValidation.ts";

const KNOWN_ENTITY_FIELDS = [
	"sessionIds",
	"routineIds",
	"cycleIds",
	"badgeIds",
	"personalRecordIds",
] as const;

function errorResponse(
	message: string,
	cors: Record<string, string>,
): Response {
	return new Response(JSON.stringify({ error: message }), {
		status: 400,
		headers: { ...cors, "Content-Type": "application/json" },
	});
}

export function validatePullRequestShape(
	body: Record<string, unknown>,
	cors: Record<string, string>,
): Response | null {
	if (typeof body.deviceId !== "string" || body.deviceId.length === 0) {
		return errorResponse("deviceId is required", cors);
	}

	if (
		body.lastSync !== undefined &&
		(typeof body.lastSync !== "number" ||
			!Number.isFinite(body.lastSync) ||
			body.lastSync < 0)
	) {
		return errorResponse("Invalid lastSync", cors);
	}

	if (body.profileId !== undefined && typeof body.profileId !== "string") {
		return errorResponse("Invalid profileId", cors);
	}

	if (body.cursor !== undefined && typeof body.cursor !== "string") {
		return errorResponse("Invalid cursor", cors);
	}

	if (
		body.pageSize !== undefined &&
		(!Number.isInteger(body.pageSize) || body.pageSize < 1)
	) {
		return errorResponse("Invalid pageSize", cors);
	}

	if (body.knownEntityIds === undefined) return null;
	if (!isJsonObject(body.knownEntityIds)) {
		return errorResponse("Invalid knownEntityIds", cors);
	}

	for (const field of KNOWN_ENTITY_FIELDS) {
		const value = body.knownEntityIds[field];
		if (value !== undefined && !Array.isArray(value)) {
			return errorResponse(`Invalid knownEntityIds.${field}`, cors);
		}
	}

	return null;
}
