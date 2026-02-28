import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog";
import { Label } from "@/app/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/app/components/ui/radio-group";
import { Textarea } from "@/app/components/ui/textarea";
import { useReportContent } from "@/mutations/community";

const REPORT_CATEGORIES = [
	{ value: "harmful_content", label: "Harmful, illegal, or abusive content" },
	{ value: "impersonation", label: "Impersonating another user" },
	{ value: "spam", label: "Spam or commercial content" },
	{ value: "malware", label: "Malware or harmful links" },
	{ value: "other", label: "Other violation" },
] as const;

interface ReportDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	contentId: string;
	contentType: "routine" | "cycle" | "comment";
}

export function ReportDialog({
	open,
	onOpenChange,
	contentId,
	contentType,
}: ReportDialogProps) {
	const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
	const [description, setDescription] = useState("");
	const reportMutation = useReportContent();

	function handleClose(isOpen: boolean) {
		if (!isOpen) {
			setSelectedCategory(null);
			setDescription("");
		}
		onOpenChange(isOpen);
	}

	function handleSubmit() {
		if (!selectedCategory) return;

		reportMutation.mutate(
			{
				contentId,
				contentType,
				category:
					selectedCategory as (typeof REPORT_CATEGORIES)[number]["value"],
				...(description.trim() ? { description: description.trim() } : {}),
			},
			{
				onSuccess: () => handleClose(false),
			},
		);
	}

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="bg-background border-secondary sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="text-white">Report Content</DialogTitle>
					<DialogDescription>
						Select a reason for reporting this content. Reports are reviewed by
						moderators.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2">
					<RadioGroup
						value={selectedCategory ?? ""}
						onValueChange={setSelectedCategory}
					>
						{REPORT_CATEGORIES.map((cat) => (
							<div key={cat.value} className="flex items-center gap-3">
								<RadioGroupItem value={cat.value} id={cat.value} />
								<Label
									htmlFor={cat.value}
									className="text-sm text-secondary-foreground cursor-pointer"
								>
									{cat.label}
								</Label>
							</div>
						))}
					</RadioGroup>

					<div className="space-y-2">
						<Label className="text-sm text-muted-foreground">
							Additional details (optional)
						</Label>
						<Textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Provide any additional context..."
							maxLength={500}
							className="text-sm bg-surface-2 border-secondary text-white min-h-20"
						/>
						<span
							className={`text-xs ${
								description.length >= 480
									? "text-destructive font-medium"
									: description.length >= 400
										? "text-amber-400"
										: "text-muted"
							}`}
						>
							{description.length}/500
						</span>
					</div>
				</div>

				<DialogFooter>
					<Button
						variant="ghost"
						onClick={() => handleClose(false)}
						className="text-muted-foreground hover:text-white"
					>
						Cancel
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={!selectedCategory || reportMutation.isPending}
						className="bg-primary hover:bg-primary/90"
					>
						Submit Report
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
