import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "../useUIStore";

describe("useUIStore", () => {
	beforeEach(() => {
		useUIStore.setState({
			streak: 0,
			notifications: { challenges: 0, community: 0 },
		});
	});

	it("has correct initial state", () => {
		const state = useUIStore.getState();
		expect(state.streak).toBe(0);
		expect(state.notifications).toEqual({ challenges: 0, community: 0 });
	});

	it("setStreak() updates streak", () => {
		useUIStore.getState().setStreak(5);
		expect(useUIStore.getState().streak).toBe(5);
	});

	it("setNotifications() with challenges only preserves community", () => {
		useUIStore.getState().setNotifications({ challenges: 3 });
		const notifs = useUIStore.getState().notifications;
		expect(notifs.challenges).toBe(3);
		expect(notifs.community).toBe(0);
	});

	it("setNotifications() with community only preserves challenges", () => {
		useUIStore.getState().setNotifications({ challenges: 3 });
		useUIStore.getState().setNotifications({ community: 7 });
		const notifs = useUIStore.getState().notifications;
		expect(notifs.challenges).toBe(3);
		expect(notifs.community).toBe(7);
	});

	it("setNotifications() with both values updates both", () => {
		useUIStore.getState().setNotifications({ challenges: 5, community: 10 });
		const notifs = useUIStore.getState().notifications;
		expect(notifs.challenges).toBe(5);
		expect(notifs.community).toBe(10);
	});

	it("setNotifications() with empty object preserves all values", () => {
		useUIStore.getState().setNotifications({ challenges: 3, community: 7 });
		useUIStore.getState().setNotifications({});
		const notifs = useUIStore.getState().notifications;
		expect(notifs.challenges).toBe(3);
		expect(notifs.community).toBe(7);
	});
});
