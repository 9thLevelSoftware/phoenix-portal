import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "./alert-dialog";

interface UnsavedChangesDialogProps {
	open: boolean;
	onSave: () => void;
	onDiscard: () => void;
	onCancel: () => void;
}

export function UnsavedChangesDialog({
	open,
	onSave,
	onDiscard,
	onCancel,
}: UnsavedChangesDialogProps) {
	return (
		<AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
			<AlertDialogContent className="bg-surface-2 border-secondary">
				<AlertDialogHeader>
					<AlertDialogTitle className="text-white">
						Discard changes?
					</AlertDialogTitle>
					<AlertDialogDescription>
						You have unsaved changes. What would you like to do?
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel
						onClick={onCancel}
						className="border-secondary text-muted-foreground hover:text-white"
					>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={onDiscard}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						Discard
					</AlertDialogAction>
					<AlertDialogAction
						onClick={onSave}
						className="bg-primary hover:bg-primary/90 border-0 text-white"
					>
						Save
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
