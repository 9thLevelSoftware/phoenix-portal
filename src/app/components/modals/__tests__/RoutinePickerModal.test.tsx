import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { RoutinePickerModal } from "../RoutinePickerModal";

describe("RoutinePickerModal", () => {
	it("uses primary-foreground on the solid routine well", () => {
		renderWithProviders(
			<RoutinePickerModal
				isOpen
				onClose={() => undefined}
				onSelect={() => undefined}
				routines={[
					{
						id: "routine-1",
						name: "Push",
						exercises: 4,
						duration: 30,
						muscleGroup: "Chest",
					},
				]}
			/>,
		);

		const icon = document.querySelector(".bg-primary svg");
		expect(icon?.classList.contains("text-primary-foreground")).toBe(true);
		expect(icon?.classList.contains("text-white")).toBe(false);
	});
});
