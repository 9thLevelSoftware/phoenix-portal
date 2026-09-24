import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { useTheme } from "@/providers/ThemeProvider";

const options: Array<{
	value: "light" | "dark" | "system";
	label: string;
	icon: LucideIcon;
}> = [
	{ value: "light", label: "Use light theme", icon: Sun },
	{ value: "dark", label: "Use dark theme", icon: Moon },
	{ value: "system", label: "Use system theme", icon: Monitor },
];

export function ThemeToggle() {
	const { theme, setTheme } = useTheme();

	return (
		<fieldset
			className="m-0 flex items-center gap-1 border-0 p-0"
			aria-label="Theme"
		>
			{options.map(({ value, label, icon: Icon }) => (
				<Button
					key={value}
					variant="ghost"
					size="icon"
					aria-label={label}
					aria-pressed={theme === value}
					title={label}
					className={
						theme === value ? "bg-accent text-accent-foreground" : undefined
					}
					onClick={() => setTheme(value)}
					type="button"
				>
					<Icon aria-hidden="true" />
				</Button>
			))}
		</fieldset>
	);
}
