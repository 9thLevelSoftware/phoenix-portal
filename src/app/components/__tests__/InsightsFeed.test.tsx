import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InsightsFeed } from "../InsightsFeed";

describe("InsightsFeed", () => {
	it("renders weight metrics with a unit separator", () => {
		render(
			<InsightsFeed
				insights={[
					{
						id: "pr",
						type: "achievement",
						title: "New PR: Bench Press",
						description: "You set a personal record on Bench Press.",
						metric: {
							name: "Bench Press",
							value: 496,
							unit: "lbs",
							delta: 22,
						},
					},
				]}
			/>,
		);

		expect(screen.getByText("496 lbs")).toBeInTheDocument();
		expect(screen.getByText("+22 lbs")).toBeInTheDocument();
	});

	it("keeps compact formatting for non-weight metrics", () => {
		render(
			<InsightsFeed
				insights={[
					{
						id: "volume",
						type: "success",
						title: "Volume Trending Up",
						description: "Your training volume increased.",
						metric: {
							name: "Volume Change",
							value: 12,
							unit: "%",
						},
					},
				]}
			/>,
		);

		expect(screen.getByText("12%")).toBeInTheDocument();
	});
});
