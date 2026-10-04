import { describe, expect, it } from "vitest";
import { afterSessionFilter, sessionCursorOf } from "@/lib/supabasePaging";

describe("session keyset cursor", () => {
	it("keeps only the (started_at, id) position", () => {
		const row = {
			started_at: "2026-05-01T12:00:00.000Z",
			id: "00000000-0000-4000-8000-000000000001",
			total_volume: 50,
		};
		expect(sessionCursorOf(row)).toEqual({
			started_at: row.started_at,
			id: row.id,
		});
	});

	it("quotes the ISO timestamp in the PostgREST or filter", () => {
		expect(
			afterSessionFilter({
				started_at: "2026-05-01T12:00:00.000Z",
				id: "00000000-0000-4000-8000-000000000001",
			}),
		).toBe(
			'started_at.gt."2026-05-01T12:00:00.000Z",and(started_at.eq."2026-05-01T12:00:00.000Z",id.gt.00000000-0000-4000-8000-000000000001)',
		);
	});
});
