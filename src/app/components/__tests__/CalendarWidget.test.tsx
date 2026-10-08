import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CalendarWidget } from "../CalendarWidget";
import { CalendarWidgetMobile } from "../CalendarWidgetMobile";

vi.mock("@/app/hooks/useIsMobile", () => ({
	useIsMobile: () => false,
}));

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function renderWidget(
	Component: typeof CalendarWidget | typeof CalendarWidgetMobile,
	onMonthChange: (date: Date) => void,
) {
	render(
		<Component
			currentMonth={new Date(2024, 0, 31)}
			onMonthChange={onMonthChange}
			workoutDates={new Set()}
			selectedDate={null}
			onDateSelect={() => {}}
		/>,
	);
}

describe("calendar widgets", () => {
	it.each([
		["desktop", CalendarWidget],
		["mobile", CalendarWidgetMobile],
	] as const)("%s uses the shared weekday labels and month navigation", async (_name, Component) => {
		const onMonthChange = vi.fn();
		renderWidget(Component, onMonthChange);

		for (const label of WEEKDAYS) {
			expect(screen.getByText(label)).toBeInTheDocument();
		}
		expect(screen.getByText("January 2024")).toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: "Next month" }));
		const next = onMonthChange.mock.calls[0]?.[0] as Date;
		expect(next.getFullYear()).toBe(2024);
		expect(next.getMonth()).toBe(1);
		expect(next.getDate()).toBe(1);

		await userEvent.click(
			screen.getByRole("button", { name: "Previous month" }),
		);
		const previous = onMonthChange.mock.calls[1]?.[0] as Date;
		expect(previous.getFullYear()).toBe(2023);
		expect(previous.getMonth()).toBe(11);
		expect(previous.getDate()).toBe(1);
	});
});
