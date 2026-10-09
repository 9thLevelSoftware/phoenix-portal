import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileAvatarImage } from "./ProfileAvatarImage";

const mocks = vi.hoisted(() => ({
	download: vi.fn(),
	viewerId: "11111111-1111-4111-8111-111111111111" as string | null,
}));
vi.mock("@/lib/supabase", () => ({
	supabase: { storage: { from: () => ({ download: mocks.download }) } },
}));
vi.mock("@/providers/AuthProvider", () => ({
	useAuth: () => ({ user: mocks.viewerId ? { id: mocks.viewerId } : null }),
}));
vi.mock("@/app/components/ui/avatar", () => ({
	AvatarImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
		<img {...props} alt={props.alt} />
	),
}));
const owner = "11111111-1111-4111-8111-111111111111";
const source = `https://api.phoenix-portal.com/storage/v1/object/public/avatars/${owner}/avatar.png`;

describe("profile avatar delivery", () => {
	beforeEach(() => {
		mocks.viewerId = owner;
		mocks.download
			.mockReset()
			.mockResolvedValue({ data: new Blob(["image"]), error: null });
		URL.createObjectURL = vi.fn().mockReturnValue("blob:avatar");
		URL.revokeObjectURL = vi.fn();
	});
	it("downloads the owner object with cache bypass and renders only the local Blob", async () => {
		const result = render(
			<ProfileAvatarImage source={source} ownerId={owner} alt="Athlete" />,
		);
		await waitFor(() =>
			expect(screen.getByAltText("Athlete")).toHaveAttribute(
				"src",
				"blob:avatar",
			),
		);
		expect(mocks.download).toHaveBeenCalledWith(
			`${owner}/avatar.png`,
			{},
			{ cache: "no-store", signal: expect.any(AbortSignal) },
		);
		result.unmount();
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:avatar");
	});
	it("never requests an attacker origin or another owner's stored reference", async () => {
		const result = render(
			<ProfileAvatarImage
				source={source.replace(
					"api.phoenix-portal.com",
					"attacker.supabase.co",
				)}
				ownerId={owner}
				alt="Athlete"
			/>,
		);
		result.rerender(
			<ProfileAvatarImage
				source={source}
				ownerId="22222222-2222-4222-8222-222222222222"
				alt="Athlete"
			/>,
		);
		await act(async () => {});
		expect(mocks.download).not.toHaveBeenCalled();
		expect(screen.queryByAltText("Athlete")).toBeNull();
	});
	it("clears delivery on logout and refuses a late response from the old principal", async () => {
		let resolve!: (result: { data: Blob; error: null }) => void;
		mocks.download.mockReturnValue(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const result = render(
			<ProfileAvatarImage source={source} ownerId={owner} alt="Athlete" />,
		);
		mocks.viewerId = null;
		result.rerender(
			<ProfileAvatarImage source={source} ownerId={owner} alt="Athlete" />,
		);
		await act(async () => {
			resolve({ data: new Blob(["image"]), error: null });
		});
		expect(screen.queryByAltText("Athlete")).toBeNull();
		expect(URL.createObjectURL).not.toHaveBeenCalled();
	});
	it("uses the fallback when RLS denies a private profile avatar", async () => {
		mocks.download.mockResolvedValue({
			data: null,
			error: { message: "not found" },
		});
		render(
			<ProfileAvatarImage source={source} ownerId={owner} alt="Athlete" />,
		);
		await act(async () => {});
		expect(screen.queryByAltText("Athlete")).toBeNull();
	});
});
