import { memoByTheme } from "./theme-tokens";

export interface PhoenixColors {
	ember: string;
	flameRed: string;
	gold: string;
	forgeGreen: string;
	white: string;
	ashGray: string;
	moltenSteel: string;
	flameYellow: string;
	mutedForeground: string;
}

const _phoenix = memoByTheme(
	(tokens): PhoenixColors => ({
		ember: tokens.primary,
		flameRed: tokens.danger,
		gold: tokens.accent,
		forgeGreen: tokens.success,
		white: tokens.foreground,
		ashGray: tokens.mutedForeground,
		moltenSteel: tokens.border,
		flameYellow: tokens.accent,
		mutedForeground: tokens.mutedForeground,
	}),
);

/** Phoenix Signal colors, resolved from the active theme at call time. */
export function PHOENIX(): PhoenixColors {
	return _phoenix();
}
