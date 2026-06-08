import { describe, expect, it } from "vitest";
import {
	getExerciseDemoMedia,
	getPrimaryExerciseDemoMedia,
} from "../exercise-demo-media";

describe("exercise demo media lookup", () => {
	it("returns bundled demo media for Tricep Pushdown", () => {
		const media = getExerciseDemoMedia("BUxuV42l6oolZVde");

		expect(media).toEqual([
			{
				angle: "ISOMETRIC",
				thumbnailUrl:
					"https://image.mux.com/XMK02bqNtt76JAbEvjknvG69J01KKPVYaDp6FWOPV9La8/thumbnail.jpg",
				videoUrl:
					"https://stream.mux.com/XMK02bqNtt76JAbEvjknvG69J01KKPVYaDp6FWOPV9La8.m3u8",
			},
		]);
	});

	it("returns the first bundled demo as the primary media item", () => {
		expect(getPrimaryExerciseDemoMedia("BUxuV42l6oolZVde")?.thumbnailUrl).toBe(
			"https://image.mux.com/XMK02bqNtt76JAbEvjknvG69J01KKPVYaDp6FWOPV9La8/thumbnail.jpg",
		);
	});

	it("returns no media for unknown or custom exercise IDs", () => {
		expect(getExerciseDemoMedia("custom_1714700000000")).toEqual([]);
		expect(getPrimaryExerciseDemoMedia("missing-exercise")).toBeNull();
	});
});
