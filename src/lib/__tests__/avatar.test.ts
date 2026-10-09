import { describe, expect, it } from "vitest";
import { avatarObjectPath } from "../avatar";

const owner = "11111111-1111-4111-8111-111111111111";
const prefix = `https://api.phoenix-portal.com/storage/v1/object/public/avatars/${owner}/`;

describe("avatar object references", () => {
	it("retains Phoenix legacy/current references and removes only the cachebuster", () => {
		expect(avatarObjectPath(`${prefix}avatar.png?t=123`, owner)).toBe(
			`${owner}/avatar.png`,
		);
		expect(
			avatarObjectPath(
				`https://ilzlswmatadlnsuxatcv.supabase.co/storage/v1/object/public/avatars/${owner}/avatar.jpg`,
				owner,
			),
		).toBe(`${owner}/avatar.jpg`);
		expect(avatarObjectPath(`${prefix}avatar.JPG`, owner)).toBe(
			`${owner}/avatar.JPG`,
		);
	});
	it.each([
		`https://attacker.supabase.co/storage/v1/object/public/avatars/${owner}/avatar.png`,
		`${prefix}avatar.png?redirect=https://attacker.test`,
		`${prefix}avatar.png#fragment`,
		`${prefix}avatar%2epng`,
		`${prefix}../avatar.png`,
		`${prefix}avatar.png/track`,
		`${prefix}avatar.png\n`,
		`https://api.phoenix-portal.com@attacker.test/storage/v1/object/public/avatars/${owner}/avatar.png`,
	])("rejects unsafe reference %s", (source) => {
		expect(avatarObjectPath(source, owner)).toBeNull();
	});
	it("rejects another owner even on a trusted storage origin", () => {
		expect(
			avatarObjectPath(
				`${prefix}avatar.png`,
				"22222222-2222-4222-8222-222222222222",
			),
		).toBeNull();
	});
});
