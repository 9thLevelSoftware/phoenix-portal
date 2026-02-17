import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Profile } from "../Profile";

describe("Profile", () => {
	it("renders without crashing", () => {
		render(<Profile />);
		expect(screen.getByText(/john doe/i)).toBeInTheDocument();
	});
});
