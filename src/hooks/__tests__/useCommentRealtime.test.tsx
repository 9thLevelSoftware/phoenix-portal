import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCommentRealtime } from "../useCommentRealtime";

const ITEM_ID = "00000000-0000-4000-8000-000000000059";

type MockChannel = {
	on: ReturnType<typeof vi.fn>;
	subscribe: ReturnType<typeof vi.fn>;
	topic: string;
};

const mocks = vi.hoisted(() => {
	const invalidateQueries = vi.fn();
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
			removeChannel.mockClear();
			this.mockSupabase.channel.mockClear();
		},
	};
});

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
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
});
