import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FormErrorSummary } from "../form-error-summary";

describe("FormErrorSummary", () => {
	beforeAll(() => {
		// jsdom does not implement scrolling.
		Element.prototype.scrollIntoView = vi.fn();
	});

	it("is an alert without a conflicting polite live region", () => {
		render(<FormErrorSummary messages={["Give this routine a name."]} />);
		const alert = screen.getByRole("alert");
		expect(alert).not.toHaveAttribute("aria-live");
	});

	it("jumps to an invalid field outside its own wrapper (builder layout)", async () => {
		// RoutineBuilder / CycleBuilder: the summary sits in its own wrapper,
		// a sibling of the header that holds the name input; there is no <form>.
		render(
			<div>
				<div>
					<FormErrorSummary messages={["Give this routine a name."]} />
				</div>
				<header>
					<input aria-label="Routine name" aria-invalid="true" />
				</header>
			</div>,
		);

		await userEvent.click(
			screen.getByRole("button", { name: /1 field needs attention/i }),
		);
		expect(screen.getByRole("textbox", { name: "Routine name" })).toHaveFocus();
	});

	it("prefers the invalid field in its own form over one elsewhere", async () => {
		render(
			<div>
				<input aria-label="Other form" aria-invalid="true" />
				<form>
					<FormErrorSummary messages={["Name is required."]} />
					<input aria-label="This form" aria-invalid="true" />
				</form>
			</div>,
		);

		await userEvent.click(
			screen.getByRole("button", { name: /1 field needs attention/i }),
		);
		expect(screen.getByRole("textbox", { name: "This form" })).toHaveFocus();
	});
});
