import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductShowcase } from "../ProductShowcase";

describe("ProductShowcase", () => {
  it("renders 4 panel labels", () => {
    render(<ProductShowcase />);
    expect(screen.getByText("Force Output")).toBeInTheDocument();
    expect(screen.getByText("Recovery")).toBeInTheDocument();
    expect(screen.getByText("PR Trend")).toBeInTheDocument();
    expect(screen.getByText("Volume")).toBeInTheDocument();
  });

  it("renders sample metric values", () => {
    render(<ProductShowcase />);
    expect(screen.getByText("95 kg")).toBeInTheDocument();
    expect(screen.getByText(/82/)).toBeInTheDocument();
  });

  it("has accessible panel structure", () => {
    const { container } = render(<ProductShowcase />);
    const panels = container.querySelectorAll("[data-panel]");
    expect(panels).toHaveLength(4);
  });
});
