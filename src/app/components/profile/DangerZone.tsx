import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
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
 * States:
 *   A) No open request     -> "Delete My Account" with confirmation dialog
 *   B) Pending, grace period active (scheduled_for > now) -> countdown + cancel
 *   C) Pending, grace period expired (scheduled_for <= now) -> "Delete Now" + cancel
 *   D) Pending but parked for support (needs_support_reason) -> what stalled
 *      and how to get it finished; still cancellable
 *   E) Executing -> the purge is running; read-only, nothing to click
 *
 * NOTE: Community content display components (comments, shared routines/cycles) should
 * handle user_id = null by displaying "[Deleted User]" as the author. This is handled
 * by the ON DELETE SET NULL FK migration, not by this component.
 *
 * Once the grace period ends, the hourly `process_due` job deletes the
 * account and cancels any subscription (KD-11); "Delete Now" only runs it
 * immediately. The copy in this file is the single source of truth for the
 * KD-11 wording — `DangerZone.test.tsx` asserts it.
 */
const GRACE_PERIOD_DAYS = 30;

/** Why a deletion stalled, in the user's words. */
const SUPPORT_REASONS: Record<string, string> = {
	billing_subscription_not_found:
		"we could not verify your subscription with our payment provider, so we stopped to make sure you are never billed again",
	request_survived_purge:
		"the deletion did not finish, so your account and data are still here",
};

function formatDeletionDate(date: Date): string {
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

export function DangerZone() {
	const { user } = useAuth();
	const userId = user?.id ?? "";

	const { data: deletionRequest, isLoading } = useQuery(
		deletionRequestOptions(userId),
	);

	const requestDeletion = useRequestDeletion(userId);
	const cancelDeletion = useCancelDeletion(userId);
	const executeDeletion = useExecuteDeletion(userId);

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
	const isExecuting = deletionRequest?.status === "executing";
	const supportReason = deletionRequest?.needs_support_reason ?? null;
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

	// Format the scheduled date (user's locale)
	const scheduledDateStr = scheduledFor ? formatDeletionDate(scheduledFor) : "";
	// Before a request exists, the date it will get: the database default and
	// grace floor are 30 days from the request (scheduled_for).
	const requestDateStr = formatDeletionDate(
		new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000),
	);

	// =========================================================================
	// State E: The purge is running right now (claimed by the hourly job or by
	// this user's own "Delete Now"). Nothing to click: the request is no longer
	// pending, so a cancel would be refused by RLS anyway.
	// =========================================================================
	if (isExecuting) {
		return (
			<Card className="border-red-900/50 bg-surface-2">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-red-400">
						<Loader2 className="h-5 w-5 animate-spin" />
						Deletion In Progress
					</CardTitle>
					<CardDescription className="text-red-300/80">
						Your account is being deleted right now. This can no longer be
						cancelled. You will be signed out once it is done.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	// =========================================================================
	// State D: The deletion stalled on something only support can clear. The
	// request stays cancellable, and the hourly job leaves it alone until the
	// reason is cleared.
	// =========================================================================
	if (hasPendingRequest && supportReason) {
		return (
			<Card className="border-amber-900/50 bg-surface-2">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-amber-400">
						<AlertTriangle className="h-5 w-5" />
						Deletion Needs Support
					</CardTitle>
					<CardDescription className="text-amber-300/80">
						We could not finish deleting your account on {scheduledDateStr}:{" "}
						{SUPPORT_REASONS[supportReason] ??
							"the deletion could not be completed"}
						. Our team has been alerted; please contact support to finish it.
						Your account and data are still here in the meantime, and you can
						cancel the deletion to keep them.
					</CardDescription>
				</CardHeader>
				<CardContent>
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
	// State C: Grace period expired — the hourly job deletes the account within
	// the hour; "Delete Now" only brings that forward.
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
							Your 30-day grace period ended on {scheduledDateStr}. Your account
							and all personal data are deleted automatically within the hour,
							and your subscription is cancelled then. Delete Now only runs it
							immediately; cancel to keep your account and manage your plan in{" "}
							<Link to="/pricing" className="underline text-foreground">
								Billing
							</Link>
							.
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
								disabled={executeDeletion.isPending}
								onClick={(event) => {
									// Keep the dialog open while the irreversible delete runs and
									// prevent a double-click from firing duplicate invocations.
									event.preventDefault();
									if (executeDeletion.isPending) return;
									executeDeletion.mutate();
								}}
							>
								{executeDeletion.isPending
									? "Deleting..."
									: "Yes, Delete Permanently"}
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
							Your account and data will be permanently deleted on{" "}
							{requestDateStr} (30 days from now). Your subscription is
							cancelled on that date, so no payment is taken after it. A renewal
							that falls due before {requestDateStr} is still charged unless you
							cancel your plan first in{" "}
							<Link to="/pricing" className="underline text-foreground">
								Billing
							</Link>
							. You can cancel the deletion until then. Your community posts
							will be anonymized.
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
