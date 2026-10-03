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
import { type ReportCategory, reportCategoryEnum } from "@/schemas/community";

const REPORT_CATEGORY_LABELS = {
	harmful_content: "Harmful, illegal, or abusive content",
	impersonation: "Impersonating another user",
	spam: "Spam or commercial content",
	malware: "Malware or harmful links",
	other: "Other violation",
} as const satisfies Record<ReportCategory, string>;

const REPORT_CATEGORIES = reportCategoryEnum.options.map((value) => ({
	value,
	label: REPORT_CATEGORY_LABELS[value],
}));

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
	const [selectedCategory, setSelectedCategory] =
		useState<ReportCategory | null>(null);
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
				category: selectedCategory,
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
					<DialogTitle className="text-foreground">Report Content</DialogTitle>
					<DialogDescription>
						Select a reason for reporting this content. Reports are reviewed by
						moderators.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2">
					<RadioGroup
						value={selectedCategory ?? ""}
						onValueChange={(value) => {
							const parsed = reportCategoryEnum.safeParse(value);
							if (parsed.success) setSelectedCategory(parsed.data);
						}}
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
							className="text-sm bg-surface-2 border-secondary text-foreground min-h-20"
						/>
						<span
							className={`text-xs ${
								description.length >= 480
									? "text-destructive font-medium"
									: description.length >= 400
										? "text-warning"
										: "text-muted-foreground"
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
						className="text-muted-foreground hover:text-foreground"
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
