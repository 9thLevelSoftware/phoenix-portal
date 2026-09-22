import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";

type Theme = "dark" | "light" | "system";
const Ctx = createContext<{
	theme: Theme;
	resolved: "dark" | "light";
	setTheme: (t: Theme) => void;
} | null>(null);

function resolve(t: Theme): "dark" | "light" {
	if (t !== "system") return t;
	return window.matchMedia("(prefers-color-scheme: light)").matches
		? "light"
		: "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>(
		() => (localStorage.getItem("phoenix-theme") as Theme) || "dark",
	);
	const [resolved, setResolved] = useState<"dark" | "light">(() =>
		resolve(theme),
	);

	useEffect(() => {
		const next = resolve(theme);
		setResolved(next);
		document.documentElement.dataset.theme = next;
		const meta = document.querySelector(
			"meta[name='color-scheme']",
		) as HTMLMetaElement | null;
		if (meta) meta.content = next + (next === "dark" ? " light" : " dark");
	}, [theme]);

	useEffect(() => {
		if (theme !== "system") return;
		const mq = window.matchMedia("(prefers-color-scheme: light)");
		const fn = () => setResolved(resolve("system"));
		mq.addEventListener("change", fn);
		return () => mq.removeEventListener("change", fn);
	}, [theme]);

	const setTheme = (t: Theme) => {
		setThemeState(t);
		localStorage.setItem("phoenix-theme", t);
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
