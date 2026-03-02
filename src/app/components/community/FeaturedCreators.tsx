import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@/app/components/ui/avatar";
import { Skeleton } from "@/app/components/ui/skeleton";
import { useBlockedUsers } from "@/hooks/useBlockedUsers";
import { featuredCreatorsOptions } from "@/queries/community";

interface FeaturedCreatorsProps {
	onSelectCreator: (userId: string) => void;
}

function getInitials(name: string): string {
	return name
		.split(" ")
		.map((w) => w.charAt(0))
		.join("")
		.toUpperCase()
		.slice(0, 2);
}

export function FeaturedCreators({ onSelectCreator }: FeaturedCreatorsProps) {
	const { data: rawCreators, isLoading } = useQuery(featuredCreatorsOptions());
	const { blockedUserIds } = useBlockedUsers();
	const creators = rawCreators?.filter((c) => !blockedUserIds.has(c.user_id));
	const scrollRef = useRef<HTMLDivElement>(null);
	const [canScrollLeft, setCanScrollLeft] = useState(false);
	const [canScrollRight, setCanScrollRight] = useState(false);

	const updateScrollState = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		setCanScrollLeft(el.scrollLeft > 0);
		setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
	}, []);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		updateScrollState();
		el.addEventListener("scroll", updateScrollState, { passive: true });
		return () => el.removeEventListener("scroll", updateScrollState);
	}, [updateScrollState]);

	const scroll = (direction: "left" | "right") => {
		const el = scrollRef.current;
		if (!el) return;
		el.scrollBy({
			left: direction === "left" ? -200 : 200,
			behavior: "smooth",
		});
	};

	// Hide entire section if no featured creators
	if (!isLoading && (!creators || creators.length === 0)) return null;

	return (
		<div className="mb-6">
			<p className="text-xs text-muted uppercase tracking-wider mb-3">
				Featured Creators
			</p>

			<div className="relative">
				{canScrollLeft && (
					<>
						<div className="absolute left-0 top-0 bottom-2 w-8 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
						<button
							onClick={() => scroll("left")}
							className="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-6 h-6 rounded-full bg-surface-2 border border-secondary flex items-center justify-center text-muted-foreground hover:text-white transition-colors"
							aria-label="Scroll left"
						>
							<ChevronLeft className="w-4 h-4" />
						</button>
					</>
				)}
				{canScrollRight && (
					<>
						<div className="absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
						<button
							onClick={() => scroll("right")}
							className="absolute right-0 top-1/2 -translate-y-1/2 z-20 w-6 h-6 rounded-full bg-surface-2 border border-secondary flex items-center justify-center text-muted-foreground hover:text-white transition-colors"
							aria-label="Scroll right"
						>
							<ChevronRight className="w-4 h-4" />
						</button>
					</>
				)}
				<div
					ref={scrollRef}
					className="flex gap-3 overflow-x-auto snap-x scrollbar-hide pb-2"
					style={{ WebkitOverflowScrolling: "touch" }}
				>
					{isLoading
						? Array.from({ length: 5 }).map((_, i) => (
								<div
									key={i}
									className="flex flex-col items-center gap-1.5 shrink-0"
								>
									<Skeleton className="w-14 h-14 rounded-full" />
									<Skeleton className="w-12 h-3 rounded" />
								</div>
							))
						: creators?.map((creator) => (
								<button
									key={creator.user_id}
									onClick={() => onSelectCreator(creator.user_id)}
									className="flex flex-col items-center gap-1.5 shrink-0 snap-start group"
								>
									<div className="ring-2 ring-primary/50 rounded-full p-0.5 group-hover:ring-primary transition-all">
										<Avatar className="w-12 h-12">
											{creator.avatar_url && (
												<AvatarImage
													src={creator.avatar_url}
													alt={creator.display_name}
												/>
											)}
											<AvatarFallback className="bg-gradient-to-br from-primary to-chart-2 text-white text-sm">
												{getInitials(creator.display_name)}
											</AvatarFallback>
										</Avatar>
									</div>
									<span className="text-[11px] text-muted-foreground max-w-16 truncate group-hover:text-white transition-colors">
										{creator.display_name}
									</span>
								</button>
							))}
				</div>
			</div>
		</div>
	);
}
