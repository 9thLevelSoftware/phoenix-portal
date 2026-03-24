import { useQueryClient } from "@tanstack/react-query";
import { Ban, Flag, MoreVertical, Pencil, Trash2 } from "lucide-react";
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
import { toastWithUndo } from "@/lib/toast-undo";
import { useBlockUser, useDeleteSharedContent } from "@/mutations/community";
import { queryKeys } from "@/queries/keys";
import { ReportDialog } from "./ReportDialog";

interface ContentActionMenuProps {
	contentId: string;
	contentType: "routine" | "cycle" | "comment";
	authorId: string | null;
	currentUserId: string;
	onEdit?: (id: string) => void;
}

export function ContentActionMenu({
	contentId,
	contentType,
	authorId,
	currentUserId,
	onEdit,
}: ContentActionMenuProps) {
	const [showReportDialog, setShowReportDialog] = useState(false);
	const [showBlockConfirm, setShowBlockConfirm] = useState(false);
	const blockMutation = useBlockUser();
	const deleteMutation = useDeleteSharedContent();
	const queryClient = useQueryClient();

	const isOwnContent = authorId === currentUserId;

	// Don't show menu for deleted user content
	if (authorId === null) return null;

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
					{isOwnContent ? (
						<>
							{onEdit && contentType !== "comment" && (
								<DropdownMenuItem
									onClick={() => onEdit(contentId)}
									className="cursor-pointer"
								>
									<Pencil className="w-4 h-4" />
									Edit
								</DropdownMenuItem>
							)}
							<DropdownMenuItem
								onClick={() => {
									// Undo toast pattern: immediate feedback with recovery window.
									// Better UX than confirmation dialog for reversible community actions.
									toastWithUndo({
										message: `${contentType === "routine" ? "Routine" : "Cycle"} removed from community`,
										action: () =>
											deleteMutation.mutateAsync({
												contentId,
												contentType: contentType as "routine" | "cycle",
											}),
										onUndo: () =>
											queryClient.invalidateQueries({
												queryKey: queryKeys.community.all,
											}),
									});
								}}
								variant="destructive"
								className="cursor-pointer"
							>
								<Trash2 className="w-4 h-4" />
								Delete
							</DropdownMenuItem>
						</>
					) : (
						<>
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
						</>
					)}
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
