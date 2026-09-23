import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCommentRealtime } from "../useCommentRealtime";

const ITEM_ID = "00000000-0000-4000-8000-000000000059";

type MockChannel = {
	on: ReturnType<typeof vi.fn>;
	subscribe: ReturnType<typeof vi.fn>;
	topic: string;
};

const mocks = vi.hoisted(() => {
	const invalidateQueries = vi.fn();
	const getQueryData = vi.fn();
	const removeChannel = vi.fn();
	const channels = new Map<string, MockChannel & { subscribed: boolean }>();
	const channelTopics: string[] = [];

	function createChannel(topic: string): MockChannel & { subscribed: boolean } {
		const channel = {
			topic,
			subscribed: false,
			on: vi.fn((type: string) => {
				if (channel.subscribed && type === "postgres_changes") {
					throw new Error(
						`cannot add \`${type}\` callbacks for ${topic} after \`subscribe()\`.`,
					);
				}
				return channel;
			}),
			subscribe: vi.fn(() => {
				channel.subscribed = true;
				return channel;
			}),
		};
		return channel;
	}

	return {
		channels,
		channelTopics,
		invalidateQueries,
		getQueryData,
		removeChannel,
		mockSupabase: {
			channel: vi.fn((topic: string) => {
				channelTopics.push(topic);
				const realtimeTopic = `realtime:${topic}`;
				const existing = channels.get(realtimeTopic);
				if (existing) {
					return existing;
				}
				const channel = createChannel(realtimeTopic);
				channels.set(realtimeTopic, channel);
				return channel;
			}),
			removeChannel,
		},
		reset() {
			channels.clear();
			channelTopics.length = 0;
			invalidateQueries.mockClear();
			getQueryData.mockReset();
			removeChannel.mockClear();
			this.mockSupabase.channel.mockClear();
		},
	};
});

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({
		invalidateQueries: mocks.invalidateQueries,
		getQueryData: mocks.getQueryData,
	}),
}));

vi.mock("@/lib/supabase", () => ({
	supabase: mocks.mockSupabase,
}));

function TestComponent({ itemId = ITEM_ID }: { itemId?: string }) {
	useCommentRealtime(itemId);
	return null;
}

describe("useCommentRealtime", () => {
	it("uses a fresh realtime channel topic when the same item remounts before Supabase finishes cleanup", () => {
		mocks.reset();

		const first = render(<TestComponent />);
		first.unmount();

		expect(() => render(<TestComponent />)).not.toThrow();
		expect(mocks.channelTopics).toHaveLength(2);
		expect(new Set(mocks.channelTopics).size).toBe(2);
		expect(mocks.channelTopics[0]).toContain(`comments:${ITEM_ID}`);
		expect(mocks.channelTopics[1]).toContain(`comments:${ITEM_ID}`);
		expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
	});

	// NF-22: Realtime cannot filter DELETE events, so deletes arrive on an
	// unfiltered listener carrying only the primary key.
	describe("comment deletes", () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		function deleteHandler() {
			const [channel] = [...mocks.channels.values()];
			if (!channel) throw new Error("no realtime channel was opened");
			const call = channel.on.mock.calls.find(
				([, config]) =>
					(config as { event?: string }).event === "DELETE" &&
					!(config as { filter?: string }).filter,
			);
			if (!call) throw new Error("no unfiltered DELETE listener");
			return call[2] as (payload: { old?: { id?: unknown } }) => void;
		}

		it("invalidates the item's comments when a cached comment is deleted", () => {
			mocks.reset();
			vi.useFakeTimers();
			mocks.getQueryData.mockReturnValue([{ id: "comment-1" }]);
			render(<TestComponent />);

			deleteHandler()({ old: { id: "comment-1" } });
			vi.advanceTimersByTime(1000);

			expect(mocks.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ["comments", ITEM_ID],
			});
		});

		it("invalidates on any delete while the comments are still loading", () => {
			mocks.reset();
			vi.useFakeTimers();
			mocks.getQueryData.mockReturnValue(undefined);
			render(<TestComponent />);

			deleteHandler()({ old: { id: "comment-1" } });
			vi.advanceTimersByTime(1000);

			expect(mocks.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ["comments", ITEM_ID],
			});
		});

		it("ignores deletes of comments that belong to other items", () => {
			mocks.reset();
			vi.useFakeTimers();
			mocks.getQueryData.mockReturnValue([{ id: "comment-1" }]);
			render(<TestComponent />);

			deleteHandler()({ old: { id: "someone-elses-comment" } });
			deleteHandler()({ old: {} });
			vi.advanceTimersByTime(1000);

			expect(mocks.invalidateQueries).not.toHaveBeenCalled();
		});
	});
});
