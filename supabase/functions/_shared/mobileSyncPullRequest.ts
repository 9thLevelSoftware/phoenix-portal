import { isJsonObject } from "./requestValidation.ts";

const KNOWN_ENTITY_FIELDS = [
	"sessionIds",
	"routineIds",
	"cycleIds",
	"badgeIds",
	"personalRecordIds",
] as const;
const UUID_FIELDS = ["sessionIds", "routineIds", "cycleIds"] as const;
const INTEGER_FIELDS = ["badgeIds", "personalRecordIds"] as const;
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INT_STRING = /^\d+$/;

function errorResponse(
	message: string,
	cors: Record<string, string>,
): Response {
	return new Response(JSON.stringify({ error: message }), {
		status: 400,
		headers: { ...cors, "Content-Type": "application/json" },
	});
}

function isPositiveIntegerId(value: unknown): boolean {
	return (
		(typeof value === "number" && Number.isInteger(value) && value > 0) ||
		(typeof value === "string" && POSITIVE_INT_STRING.test(value))
	);
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

	for (const field of UUID_FIELDS) {
		const ids = body.knownEntityIds[field];
		if (
			Array.isArray(ids) &&
			!ids.every((id) => typeof id === "string" && UUID_REGEX.test(id))
		) {
			return errorResponse(`Invalid knownEntityIds.${field} entry`, cors);
		}
	}

	for (const field of INTEGER_FIELDS) {
		const ids = body.knownEntityIds[field];
		if (Array.isArray(ids) && !ids.every(isPositiveIntegerId)) {
			return errorResponse(`Invalid knownEntityIds.${field} entry`, cors);
		}
	}

	return null;
}
