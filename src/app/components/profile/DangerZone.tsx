import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2, XCircle } from "lucide-react";
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
import { Button } from "@/app/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/app/components/ui/card";
import { useAuth } from "@/app/hooks/useAuth";
import {
	deletionRequestOptions,
	useCancelDeletion,
	useExecuteDeletion,
	useRequestDeletion,
} from "@/mutations/account";

/**
 * DangerZone — Account deletion UI for the Profile settings tab.
 *
 * Three states:
 *   A) No pending request  -> "Delete My Account" with confirmation dialog
 *   B) Pending, grace period active (scheduled_for > now) -> countdown + cancel
 *   C) Pending, grace period expired (scheduled_for <= now) -> "Delete Now" + cancel
 *
 * NOTE: Community content display components (comments, shared routines/cycles) should
 * handle user_id = null by displaying "[Deleted User]" as the author. This is handled
 * by the ON DELETE SET NULL FK migration, not by this component.
 */
export function DangerZone() {
	const { user } = useAuth();
	const userId = user?.id ?? "";

	const { data: deletionRequest, isLoading } = useQuery(
		deletionRequestOptions(userId),
	);

	const requestDeletion = useRequestDeletion(userId);
	const cancelDeletion = useCancelDeletion(userId);
	const executeDeletion = useExecuteDeletion();

	const [showRequestDialog, setShowRequestDialog] = useState(false);
	const [showExecuteDialog, setShowExecuteDialog] = useState(false);

	if (isLoading) {
		return (
			<Card className="border-secondary bg-surface-2">
				<CardContent className="flex items-center justify-center py-8">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		);
	}

	// Determine current state
	const hasPendingRequest = !!deletionRequest;
	const scheduledFor = deletionRequest
		? new Date(deletionRequest.scheduled_for)
		: null;
	const now = new Date();
	const gracePeriodExpired = scheduledFor ? scheduledFor <= now : false;

	// Days remaining in grace period
	const daysRemaining = scheduledFor
		? Math.max(
				0,
				Math.ceil(
					(scheduledFor.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
				),
			)
		: 0;

	// Format the scheduled date
	const scheduledDateStr = scheduledFor
		? scheduledFor.toLocaleDateString("en-US", {
				year: "numeric",
				month: "long",
				day: "numeric",
			})
		: "";

	// =========================================================================
	// State C: Grace period expired — user can execute deletion or cancel
	// =========================================================================
	if (hasPendingRequest && gracePeriodExpired) {
		return (
			<>
				<Card className="border-red-900/50 bg-surface-2">
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-red-400">
							<AlertTriangle className="h-5 w-5" />
							Account Deletion Ready
						</CardTitle>
						<CardDescription className="text-red-300/80">
							Your 30-day grace period has ended. You can now permanently delete
							your account, or cancel to keep it.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex flex-col sm:flex-row gap-3">
							<Button
								variant="destructive"
								onClick={() => setShowExecuteDialog(true)}
								disabled={executeDeletion.isPending}
								className="flex-1"
							>
								{executeDeletion.isPending ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<Trash2 className="mr-2 h-4 w-4" />
								)}
								Delete Now
							</Button>
							<Button
								variant="outline"
								onClick={() => cancelDeletion.mutate()}
								disabled={cancelDeletion.isPending}
								className="flex-1 border-secondary text-white hover:bg-secondary/50"
							>
								{cancelDeletion.isPending ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<XCircle className="mr-2 h-4 w-4" />
								)}
								Cancel Deletion
							</Button>
						</div>
					</CardContent>
				</Card>

				{/* Final confirmation dialog for permanent deletion */}
				<AlertDialog
					open={showExecuteDialog}
					onOpenChange={setShowExecuteDialog}
				>
					<AlertDialogContent className="border-red-900/50">
						<AlertDialogHeader>
							<AlertDialogTitle className="text-red-400">
								Permanent Deletion
							</AlertDialogTitle>
							<AlertDialogDescription>
								This action is irreversible. Your account, all personal data,
								and your subscription will be permanently deleted. Community
								posts will be anonymized. Proceed?
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								className="bg-red-600 hover:bg-red-700 text-white"
								onClick={() => executeDeletion.mutate()}
							>
								Yes, Delete Permanently
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</>
		);
	}

	// =========================================================================
	// State B: Pending deletion, grace period still active
	// =========================================================================
	if (hasPendingRequest && !gracePeriodExpired) {
		return (
			<Card className="border-amber-900/50 bg-surface-2">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-amber-400">
						<AlertTriangle className="h-5 w-5" />
						Deletion Scheduled
					</CardTitle>
					<CardDescription className="text-amber-300/80">
						Your account is scheduled for deletion on{" "}
						<span className="font-medium text-amber-300">
							{scheduledDateStr}
						</span>{" "}
						({daysRemaining} {daysRemaining === 1 ? "day" : "days"} remaining)
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="text-sm text-muted-foreground">
						Changed your mind? Cancel the deletion request to keep your account.
					</p>
					<Button
						variant="outline"
						onClick={() => cancelDeletion.mutate()}
						disabled={cancelDeletion.isPending}
						className="w-full border-amber-600/50 text-amber-400 hover:bg-amber-600/10"
					>
						{cancelDeletion.isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<XCircle className="mr-2 h-4 w-4" />
						)}
						Cancel Deletion
					</Button>
				</CardContent>
			</Card>
		);
	}

	// =========================================================================
	// State A: No pending request — show "Delete My Account"
	// =========================================================================
	return (
		<>
			<Card className="border-red-900/50 bg-surface-2">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-red-400">
						<AlertTriangle className="h-5 w-5" />
						Danger Zone
					</CardTitle>
					<CardDescription>
						Permanently delete your account and all associated data
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button
						variant="destructive"
						onClick={() => setShowRequestDialog(true)}
						disabled={requestDeletion.isPending}
						className="w-full"
					>
						{requestDeletion.isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Trash2 className="mr-2 h-4 w-4" />
						)}
						Delete My Account
					</Button>
				</CardContent>
			</Card>

			{/* Confirmation dialog */}
			<AlertDialog open={showRequestDialog} onOpenChange={setShowRequestDialog}>
				<AlertDialogContent className="border-red-900/50">
					<AlertDialogHeader>
						<AlertDialogTitle className="text-red-400">
							Are you sure?
						</AlertDialogTitle>
						<AlertDialogDescription>
							This will schedule your account for permanent deletion in 30 days.
							During this period you can still cancel. After 30 days, all your
							data will be permanently deleted, your subscription will be
							cancelled, and your community posts will be anonymized.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-red-600 hover:bg-red-700 text-white"
							onClick={() => requestDeletion.mutate()}
						>
							Yes, Delete My Account
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
