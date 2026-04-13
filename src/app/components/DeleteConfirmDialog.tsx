import { Loader2 } from "lucide-react";
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

interface DeleteConfirmDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	itemName: string;
	itemType: "routine" | "cycle";
	isActive?: boolean;
	isDeleting?: boolean;
	onConfirm: () => void;
}

export function DeleteConfirmDialog({
	open,
	onOpenChange,
	title,
	itemName,
	itemType,
	isActive = false,
	isDeleting = false,
	onConfirm,
}: DeleteConfirmDialogProps) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent className="border-red-900/50">
				<AlertDialogHeader>
					<AlertDialogTitle className="text-red-400">{title}</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-2 text-sm text-muted-foreground">
							<p>
								This will permanently delete{" "}
								<span className="font-medium text-white">"{itemName}"</span> and
								remove it from your mobile app on the next sync.
							</p>
							{isActive && itemType === "cycle" && (
								<p className="text-amber-400">
									This cycle is currently active on your mobile app. It will be
									deactivated.
								</p>
							)}
							<p>Your workout history will be preserved.</p>
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						className="bg-red-600 hover:bg-red-700 text-white"
						onClick={onConfirm}
						disabled={isDeleting}
					>
						{isDeleting ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Deleting...
							</>
						) : (
							"Delete"
						)}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
