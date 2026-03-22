/**
 * ProductShowcase — 2x2 grid of mock dashboard panels for the landing page hero.
 * Each panel previews a real product feature with hardcoded sample data.
 * Design: "precision performance cockpit" — sharp borders, mono labels, dense data.
 */
import { motion } from "motion/react";

// ─── Panel wrapper ─────────────────────────────────────────────────────────────

interface PanelProps {
	label: string;
	index: number;
	children: React.ReactNode;
}

function Panel({ label, index, children }: PanelProps) {
	return (
		<motion.div
			data-panel
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.4, delay: index * 0.08, ease: "easeOut" }}
			className="rounded-lg border border-white/[0.06] bg-surface-2 p-4 flex flex-col gap-3"
		>
			<span className="eyebrow text-muted-foreground">{label}</span>
			{children}
		</motion.div>
	);
}

// ─── Panel 1: Force Output ─────────────────────────────────────────────────────

function ForceOutputPanel() {
	return (
		<Panel label="Force Output" index={0}>
			{/* Mini SVG force curve */}
			<svg
				viewBox="0 0 120 48"
				aria-label="Sample force curve showing peak force of 95 kg"
				className="w-full"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
			>
				<defs>
					<linearGradient id="force-gradient" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
						<stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
					</linearGradient>
				</defs>
				{/* Filled area under the curve */}
				<path
					d="M0 44 C15 44 20 36 30 14 C40 0 50 4 60 8 C70 12 75 10 85 20 C95 30 105 42 120 44 Z"
					fill="url(#force-gradient)"
				/>
				{/* The curve line itself */}
				<path
					d="M0 44 C15 44 20 36 30 14 C40 0 50 4 60 8 C70 12 75 10 85 20 C95 30 105 42 120 44"
					stroke="var(--primary)"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
			{/* Metric */}
			<div className="flex items-baseline gap-1.5">
				<span className="text-lg font-semibold text-foreground">95 kg</span>
				<span className="eyebrow text-muted-foreground">peak</span>
			</div>
		</Panel>
	);
}

// ─── Panel 2: Recovery ─────────────────────────────────────────────────────────

function RecoveryPanel() {
	const radius = 18;
	const circumference = 2 * Math.PI * radius;
	const score = 82;
	const dashOffset = circumference * (1 - score / 100);

	return (
		<Panel label="Recovery" index={1}>
			<div className="flex items-center gap-3">
				{/* Circular gauge */}
				<svg
					viewBox="0 0 48 48"
					className="w-12 h-12 shrink-0"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
					aria-hidden="true"
				>
					{/* Background track */}
					<circle
						cx="24"
						cy="24"
						r={radius}
						stroke="rgba(255,255,255,0.06)"
						strokeWidth="4"
						fill="none"
					/>
					{/* Progress arc */}
					<circle
						cx="24"
						cy="24"
						r={radius}
						stroke="var(--semantic-positive, #10B981)"
						strokeWidth="4"
						fill="none"
						strokeDasharray={circumference}
						strokeDashoffset={dashOffset}
						strokeLinecap="round"
						transform="rotate(-90 24 24)"
					/>
					{/* Score text */}
					<text
						x="24"
						y="24"
						dominantBaseline="middle"
						textAnchor="middle"
						fill="white"
						fontSize="11"
						fontWeight="600"
					>
						{score}
					</text>
				</svg>
				{/* Labels */}
				<div className="flex flex-col gap-0.5">
					<span className="text-sm font-medium text-foreground">
						Ready to train
					</span>
					<span className="text-xs text-semantic-positive">
						Fully recovered
					</span>
				</div>
			</div>
		</Panel>
	);
}

// ─── Panel 3: PR Trend ─────────────────────────────────────────────────────────

function PRTrendPanel() {
	return (
		<Panel label="PR Trend" index={2}>
			<div className="flex items-center justify-between">
				{/* Left: metric */}
				<div className="flex flex-col gap-0.5">
					<span className="text-2xl font-semibold text-foreground">+12%</span>
					<span className="text-xs text-muted-foreground">Bench press 1RM</span>
				</div>
				{/* Right: sparkline */}
				<svg
					viewBox="0 0 60 24"
					className="w-14 h-6"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
					aria-hidden="true"
				>
					<polyline
						points="0,20 10,18 20,15 30,12 40,8 50,5 60,2"
						stroke="var(--primary)"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						fill="none"
					/>
				</svg>
			</div>
		</Panel>
	);
}

// ─── Panel 4: Volume ───────────────────────────────────────────────────────────

function VolumePanel() {
	return (
		<Panel label="Volume" index={3}>
			<div className="flex flex-col gap-2">
				{/* This week bar */}
				<div className="flex flex-col gap-1">
					<div className="flex justify-between items-baseline">
						<span className="text-xs text-muted-foreground">This wk</span>
						<span className="text-xs font-medium text-foreground">18,400</span>
					</div>
					<div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
						<div
							className="h-full rounded-full bg-primary"
							style={{ width: "78%" }}
						/>
					</div>
				</div>
				{/* Last week bar */}
				<div className="flex flex-col gap-1">
					<div className="flex justify-between items-baseline">
						<span className="text-xs text-muted-foreground">Last wk</span>
						<span className="text-xs font-medium text-foreground">14,950</span>
					</div>
					<div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
						<div
							className="h-full rounded-full bg-white/20"
							style={{ width: "62%" }}
						/>
					</div>
				</div>
				{/* Delta label */}
				<span className="text-xs text-semantic-positive">+23% volume</span>
			</div>
		</Panel>
	);
}

// ─── Export ────────────────────────────────────────────────────────────────────

export function ProductShowcase() {
	return (
		<div className="grid grid-cols-2 gap-3 w-full">
			<ForceOutputPanel />
			<RecoveryPanel />
			<PRTrendPanel />
			<VolumePanel />
		</div>
	);
}
