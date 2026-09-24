import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { invalidateThemeTokens, THEME_CHANGE_EVENT } from "@/lib/theme-tokens";

type Theme = "dark" | "light" | "system";
type ResolvedTheme = "dark" | "light";

const Ctx = createContext<{
	theme: Theme;
	resolved: ResolvedTheme;
	setTheme: (t: Theme) => void;
} | null>(null);

function isTheme(value: string | null): value is Theme {
	return value === "dark" || value === "light" || value === "system";
}

function getPersistedTheme(): Theme {
	try {
		const persisted = localStorage.getItem("phoenix-theme");
		return isTheme(persisted) ? persisted : "dark";
	} catch {
		return "dark";
	}
}

function resolve(t: Theme): ResolvedTheme {
	if (t !== "system") return t;
	return window.matchMedia("(prefers-color-scheme: light)").matches
		? "light"
		: "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>(getPersistedTheme);
	const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(theme));

	useEffect(() => {
		setResolved(resolve(theme));
	}, [theme]);

	useEffect(() => {
		const root = document.documentElement;
		root.dataset.theme = resolved;
		// Only the resolved scheme: "dark light" would let the OS preference win
		// for native controls and scrollbars over an explicit choice.
		const meta = document.querySelector<HTMLMetaElement>(
			"meta[name='color-scheme']",
		);
		if (meta) meta.content = resolved;
		// Colour snapshots read by canvas/ECharts code must be re-read before
		// anyone is told the theme changed.
		invalidateThemeTokens();
		window.dispatchEvent(
			new CustomEvent(THEME_CHANGE_EVENT, { detail: resolved }),
		);
	}, [resolved]);

	useEffect(() => {
		if (theme !== "system") return;
		const mq = window.matchMedia("(prefers-color-scheme: light)");
		const fn = () => setResolved(resolve("system"));
		mq.addEventListener("change", fn);
		return () => mq.removeEventListener("change", fn);
	}, [theme]);

	const setTheme = useCallback((t: Theme) => {
		setThemeState(t);
		try {
			localStorage.setItem("phoenix-theme", t);
		} catch {
			// Theme state still applies when storage is unavailable.
		}
	}, []);

	const value = useMemo(
		() => ({ theme, resolved, setTheme }),
		[theme, resolved, setTheme],
	);

	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The resolved theme, or "dark" outside a ThemeProvider (tests, isolated trees). */
export function useResolvedTheme(): ResolvedTheme {
	return useContext(Ctx)?.resolved ?? "dark";
}

export function useTheme() {
	const ctx = useContext(Ctx);
	if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
	return ctx;
}
