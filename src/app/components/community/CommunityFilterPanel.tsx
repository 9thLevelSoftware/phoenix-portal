import { Filter } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/app/components/ui/sheet";
import { useCommunityStore } from "@/stores/useCommunityStore";

const MUSCLE_GROUPS = [
	"Chest",
	"Back",
	"Shoulders",
	"Arms",
	"Legs",
	"Core",
	"Full Body",
	"Other",
] as const;

const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"] as const;

export function CommunityFilterPanel() {
	const [open, setOpen] = useState(false);
	const filters = useCommunityStore((s) => s.filters);
	const setFilters = useCommunityStore((s) => s.setFilters);

	const activeCount =
		(filters.muscleGroup ? 1 : 0) + (filters.difficulty ? 1 : 0);

	const [localMuscle, setLocalMuscle] = useState(filters.muscleGroup ?? "");
	const [localDifficulty, setLocalDifficulty] = useState(
		filters.difficulty ?? "",
	);

	const handleOpen = () => {
		setLocalMuscle(filters.muscleGroup ?? "");
		setLocalDifficulty(filters.difficulty ?? "");
		setOpen(true);
	};

	const handleApply = () => {
		setFilters({
			muscleGroup: localMuscle || undefined,
			difficulty: localDifficulty || undefined,
		});
		setOpen(false);
	};

	const handleClear = () => {
		setLocalMuscle("");
		setLocalDifficulty("");
		setFilters({});
		setOpen(false);
	};

	return (
		<>
			<Button
				variant="outline"
				size="sm"
				onClick={handleOpen}
				className="border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-white relative"
			>
				<Filter className="w-4 h-4 mr-1.5" />
				Filter
				{activeCount > 0 && (
					<Badge className="absolute -top-2 -right-2 bg-[#FF6B35] text-white text-[10px] px-1.5 py-0 min-w-[18px] h-[18px] flex items-center justify-center border-0">
						{activeCount}
					</Badge>
				)}
			</Button>

			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent side="right" className="bg-[#0D0D0D] border-[#374151]">
					<SheetHeader>
						<SheetTitle className="text-white">Filters</SheetTitle>
						<SheetDescription className="text-[#9CA3AF]">
							Narrow down the feed by muscle group and difficulty.
						</SheetDescription>
					</SheetHeader>

					<div className="flex flex-col gap-6 px-4 py-6">
						{/* Muscle Group */}
						<div className="space-y-2">
							<label className="text-sm text-[#9CA3AF]">Muscle Group</label>
							<Select value={localMuscle} onValueChange={setLocalMuscle}>
								<SelectTrigger className="bg-[#1a1a1a] border-[#374151] text-white">
									<SelectValue placeholder="All muscle groups" />
								</SelectTrigger>
								<SelectContent className="bg-[#1a1a1a] border-[#374151]">
									{MUSCLE_GROUPS.map((group) => (
										<SelectItem key={group} value={group}>
											{group}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{/* Difficulty */}
						<div className="space-y-2">
							<label className="text-sm text-[#9CA3AF]">Difficulty</label>
							<Select
								value={localDifficulty}
								onValueChange={setLocalDifficulty}
							>
								<SelectTrigger className="bg-[#1a1a1a] border-[#374151] text-white">
									<SelectValue placeholder="All difficulties" />
								</SelectTrigger>
								<SelectContent className="bg-[#1a1a1a] border-[#374151]">
									{DIFFICULTIES.map((diff) => (
										<SelectItem key={diff} value={diff}>
											{diff}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="flex gap-3 px-4 mt-auto pb-6">
						<Button
							variant="outline"
							className="flex-1 border-[#374151] text-[#9CA3AF] hover:text-white"
							onClick={handleClear}
						>
							Clear Filters
						</Button>
						<Button
							className="flex-1 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
							onClick={handleApply}
						>
							Apply
						</Button>
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}
