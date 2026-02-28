import { Ban, Flag, MoreVertical } from "lucide-react";
import { useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { useBlockUser } from "@/mutations/community";
import { ReportDialog } from "./ReportDialog";

interface ContentActionMenuProps {
	contentId: string;
	contentType: "routine" | "cycle" | "comment";
	authorId: string | null;
	currentUserId: string;
}

export function ContentActionMenu({
	contentId,
	contentType,
	authorId,
	currentUserId,
}: ContentActionMenuProps) {
	const [showReportDialog, setShowReportDialog] = useState(false);
	const [showBlockConfirm, setShowBlockConfirm] = useState(false);
	const blockMutation = useBlockUser();

	// Don't show menu on own content or deleted user content
	if (authorId === null || authorId === currentUserId) return null;

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						onClick={(e) => e.stopPropagation()}
						className="p-1 rounded-md text-muted-foreground hover:text-white hover:bg-[#1a1a2e] transition-colors"
						aria-label="Content actions"
					>
						<MoreVertical className="w-4 h-4" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					className="bg-[#1a1a2e] border-[#374151]"
					onClick={(e) => e.stopPropagation()}
				>
					<DropdownMenuItem
						onClick={() => setShowReportDialog(true)}
						className="cursor-pointer"
					>
						<Flag className="w-4 h-4" />
						Report
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => setShowBlockConfirm(true)}
						variant="destructive"
						className="cursor-pointer"
					>
						<Ban className="w-4 h-4" />
						Block User
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<ReportDialog
				open={showReportDialog}
				onOpenChange={setShowReportDialog}
				contentId={contentId}
				contentType={contentType}
			/>

			<AlertDialog open={showBlockConfirm} onOpenChange={setShowBlockConfirm}>
				<AlertDialogContent className="bg-background border-secondary">
					<AlertDialogHeader>
						<AlertDialogTitle className="text-white">
							Block this user?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Their posts and comments will be hidden from your feed. You can
							unblock them later in Settings.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="border-secondary text-muted-foreground">
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => blockMutation.mutate({ blockedId: authorId })}
							className="bg-destructive hover:bg-destructive/90"
						>
							Block
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
