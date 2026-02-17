import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/app/components/ui/input";
import { useDebounce } from "@/hooks/useDebounce";
import { useCommunityStore } from "@/stores/useCommunityStore";

export function CommunitySearch() {
	const activeTab = useCommunityStore((s) => s.activeTab);
	const setSearch = useCommunityStore((s) => s.setSearch);

	const [localValue, setLocalValue] = useState("");
	const debouncedValue = useDebounce(localValue, 300);

	useEffect(() => {
		setSearch(debouncedValue);
	}, [debouncedValue, setSearch]);

	const placeholder =
		activeTab === "routines" ? "Search routines..." : "Search cycles...";

	return (
		<div className="relative flex-1">
			<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
			<Input
				value={localValue}
				onChange={(e) => setLocalValue(e.target.value)}
				placeholder={placeholder}
				className="pl-9 pr-8 bg-surface-2 border-secondary text-white placeholder:text-muted"
			/>
			{localValue && (
				<button
					onClick={() => setLocalValue("")}
					className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white transition-colors"
				>
					<X className="w-4 h-4" />
				</button>
			)}
		</div>
	);
}
