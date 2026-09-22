import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";

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
		const meta = document.querySelector(
			"meta[name='color-scheme']",
		) as HTMLMetaElement | null;
		if (meta)
			meta.content = resolved + (resolved === "dark" ? " light" : " dark");
		window.dispatchEvent(
			new CustomEvent("phoenix-theme-change", { detail: resolved }),
		);
	}, [resolved]);

	useEffect(() => {
		if (theme !== "system") return;
		const mq = window.matchMedia("(prefers-color-scheme: light)");
		const fn = () => setResolved(resolve("system"));
		mq.addEventListener("change", fn);
		return () => mq.removeEventListener("change", fn);
	}, [theme]);

	const setTheme = (t: Theme) => {
		setThemeState(t);
		try {
			localStorage.setItem("phoenix-theme", t);
		} catch {
			// Theme state still applies when storage is unavailable.
		}
	};

	return (
		<Ctx.Provider value={{ theme, resolved, setTheme }}>
			{children}
		</Ctx.Provider>
	);
}

export function useTheme() {
	const ctx = useContext(Ctx);
	if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
	return ctx;
}
