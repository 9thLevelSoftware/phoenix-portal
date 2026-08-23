import { describe, expect, it } from "vitest";
import {
	CHILD_PAGE_SIZE,
	fetchAllByParentIds,
	type PagedFromClient,
} from "../../supabase/functions/_shared/pagedByParent.ts";

function rows(count: number, parentId: string): Record<string, unknown>[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `${parentId}-${i}`,
		parent_id: parentId,
	}));
}

function fakeClient(
	pages: Array<{ data: unknown; error: unknown }>,
): PagedFromClient & { ranges: Array<[number, number]>; fromCalls: number } {
	const ranges: Array<[number, number]> = [];
	let fromCalls = 0;
	let i = 0;
	const builder: Record<string, unknown> = {};
	const chain = () => builder;
	builder.select = chain;
	builder.in = chain;
	builder.eq = chain;
	builder.order = chain;
	builder.range = (from: number, to: number) => {
		ranges.push([from, to]);
		return builder;
	};
	builder.then = (
		resolve: (value: unknown) => unknown,
		reject?: (reason: unknown) => unknown,
	) => {
		const page = pages[i++] ?? { data: [], error: null };
		return Promise.resolve(page).then(resolve, reject);
	};
	return {
		from: () => {
			fromCalls += 1;
			return builder;
		},
		get ranges() {
			return ranges;
		},
		get fromCalls() {
			return fromCalls;
		},
	};
}

describe("fetchAllByParentIds KD-28", () => {
	it("continues iff length === PAGE+1 and completes iff length <= PAGE", async () => {
		const client = fakeClient([
			{ data: rows(CHILD_PAGE_SIZE + 1, "s1"), error: null },
			{ data: rows(CHILD_PAGE_SIZE, "s1"), error: null },
		]);
		const result = await fetchAllByParentIds(client, {
			table: "exercises",
			parentColumn: "session_id",
			parentIds: ["s1"],
			entity: "session exercises",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.rows).toHaveLength(CHILD_PAGE_SIZE * 2);
		}
		expect(client.ranges[0]).toEqual([0, CHILD_PAGE_SIZE]);
		expect(client.ranges[1]).toEqual([CHILD_PAGE_SIZE, CHILD_PAGE_SIZE * 2]);
	});

	it("HTTP-complete when the last page is exactly PAGE", async () => {
		const client = fakeClient([
			{ data: rows(CHILD_PAGE_SIZE, "s1"), error: null },
		]);
		const result = await fetchAllByParentIds(client, {
			table: "exercises",
			parentColumn: "session_id",
			parentIds: ["s1"],
			entity: "session exercises",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.rows).toHaveLength(CHILD_PAGE_SIZE);
		}
		expect(client.ranges).toHaveLength(1);
	});

	it("overflows only when a single parent returns PAGE+1 and Range is refused", async () => {
		const client = fakeClient([
			{ data: rows(CHILD_PAGE_SIZE + 1, "s1"), error: null },
			{ data: null, error: { message: "Requested range not satisfiable" } },
		]);
		const result = await fetchAllByParentIds(client, {
			table: "exercises",
			parentColumn: "session_id",
			parentIds: ["s1"],
			entity: "session exercises",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.kind).toBe("overflow");
			if (result.kind === "overflow") {
				expect(result.parentId).toBe("s1");
			}
		}
	});

	it("does not overflow when a multi-parent chunk is full and pageable", async () => {
		const firstPage = [
			...rows(CHILD_PAGE_SIZE, "s1"),
			rows(1, "s2")[0],
		];
		const client = fakeClient([
			{ data: firstPage, error: null },
			{ data: rows(3, "s2"), error: null },
		]);
		const result = await fetchAllByParentIds(client, {
			table: "exercises",
			parentColumn: "session_id",
			parentIds: ["s1", "s2"],
			entity: "session exercises",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.rows.length).toBeGreaterThan(CHILD_PAGE_SIZE);
		}
	});
});
