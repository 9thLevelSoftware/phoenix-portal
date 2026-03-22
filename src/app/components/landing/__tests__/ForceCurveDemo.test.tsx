import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ForceCurveDemo } from "../ForceCurveDemo";

describe("ForceCurveDemo", () => {
	it("renders the chart container", () => {
		const { container } = render(<ForceCurveDemo />);
		expect(container.querySelector("svg")).toBeInTheDocument();
	});

	it("renders section label", () => {
		render(<ForceCurveDemo />);
		expect(screen.getByText(/bench press/i)).toBeInTheDocument();
	});

	it("shows axis labels", () => {
		render(<ForceCurveDemo />);
		expect(screen.getByText("Force (kg)")).toBeInTheDocument();
	});

	it("renders phase labels", () => {
		render(<ForceCurveDemo />);
		expect(screen.getByText("Concentric")).toBeInTheDocument();
		expect(screen.getByText("Eccentric")).toBeInTheDocument();
	});
});
