import { Flame } from "lucide-react";
import { motion } from "motion/react";

export function PageLoading() {
	return (
		<div className="flex-1 flex items-center justify-center h-[calc(100vh-4rem)]">
			<div className="flex flex-col items-center gap-4">
				<motion.div
					animate={{
						scale: [1, 1.15, 1],
						opacity: [0.7, 1, 0.7],
					}}
					transition={{
						duration: 1.5,
						repeat: Number.POSITIVE_INFINITY,
						ease: "easeInOut",
					}}
					className="relative"
				>
					<Flame className="w-10 h-10 text-primary" strokeWidth={1.5} />
					<motion.div
						className="absolute inset-0 rounded-full bg-primary/20 blur-xl"
						animate={{
							scale: [0.8, 1.3, 0.8],
							opacity: [0.3, 0.6, 0.3],
						}}
						transition={{
							duration: 1.5,
							repeat: Number.POSITIVE_INFINITY,
							ease: "easeInOut",
						}}
					/>
				</motion.div>
				<p className="text-muted-foreground text-sm">Loading...</p>
			</div>
		</div>
	);
}
