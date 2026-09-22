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

/** Days between the request and the automatic purge (KD-11: billing stops then). */
const GRACE_DAYS = 30;

/**
 * `needs_support_reason` values `delete-account/index.ts` can park a row with
 * (`NEEDS_SUPPORT_REASON` / `SURVIVED_PURGE_REASON`). Anything else is a
 * stalled purge of the same kind, so it falls through to the second clause —
 * true of every parked row, and the copy never claims a specific cause it
 * cannot know.
 */
function supportReasonSentence(reason: string | null | undefined): string {
	return reason === "request_survived_purge"
		? "the deletion did not finish, so your account and data are still here"
		: "we could not verify your subscription with our payment provider";
}

/**
 * The copy is English prose, so the date is formatted the same way the tests'
 * `localeDate` does — otherwise a non-en browser locale would put "19.
 * September 2026" inside an English sentence and break the contract strings.
 */
function formatDeletionDate(date: Date | null): string {
	if (!date) return "";
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

/**
 * DangerZone — Account deletion UI for the Profile settings tab.
 *
 * Five states (KD-11):
 *   A) No pending request  -> "Delete My Account" with confirmation dialog
 *   B) Pending, grace period active (scheduled_for > now) -> countdown + cancel
 *   C) Pending, grace period expired (scheduled_for <= now) -> deleted
 *      automatically within the hour; "Delete Now" only runs it immediately
 *   D) status 'executing'  -> read-only "deletion in progress", no actions
 *   E) needs_support_reason set -> a purge stopped for a human. Cancelling is
 *      still offered; "Delete Now" is not, because it is guaranteed to fail
 *      again (`process_due` skips these rows entirely).
 *
 * Billing stops at day 30 of a deletion request. A renewal that falls due
 * BEFORE that date is still charged, so both the confirm dialog and the
 * expiry card say so and link to Billing.
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

	// The purge has started: process_due claimed the row (status 'executing')
	// and the account is being deleted right now. Nothing can be offered here —
	// the cancel UPDATE only matches 'pending', and the request RPC answers
	// 'already_executing'. Without this branch the row (whose scheduled_for is
	// already past) would render State C, i.e. "Delete Now" / "Cancel Deletion"
	// buttons that cannot do anything.
	if (deletionRequest?.status === "executing") {
		return (
			<Card className="border-red-900/50 bg-surface-2">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-red-400">
						<Loader2 className="h-5 w-5 animate-spin" />
						Deletion In Progress
					</CardTitle>
					<CardDescription className="text-red-300/80">
						Your account is being deleted right now. This can no longer be
						cancelled. You will be signed out when it completes.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const scheduledFor = deletionRequest
		? new Date(deletionRequest.scheduled_for)
		: null;
	const scheduledDateStr = formatDeletionDate(scheduledFor);

	// What "in 30 days" means, named as a date in every place money is involved.
	const deletionDateStr = formatDeletionDate(
		new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000),
	);

	// =========================================================================
	// State E: A purge stopped for a reason only a human can resolve. The row
	// is back to 'pending' with `needs_support_reason` set and `process_due`
	// skips it (`.is('needs_support_reason', null)`), so this outranks the
	// ordinary expiry below — `scheduled_for` is typically already past here.
	// =========================================================================
	if (deletionRequest?.needs_support_reason) {
		return (
			<Card className="border-amber-900/50 bg-surface-2">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-amber-400">
						<AlertTriangle className="h-5 w-5" />
						Deletion Needs Support
					</CardTitle>
					<CardDescription className="text-amber-300/80">
						We could not finish deleting your account on {scheduledDateStr}{" "}
						because {supportReasonSentence(deletionRequest.needs_support_reason)}
						; please contact support to finish it.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="text-sm text-muted-foreground">
						Your account and data are still here. Cancelling keeps them.
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

	// Determine current state
	const hasPendingRequest = deletionRequest?.status === "pending";
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

	// =========================================================================
	// State C: Grace period expired — the hourly purge will run this within the
	// hour. "Delete Now" is an expedite, not the only route (KD-11).
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
							immediately. A renewal that falls due before {scheduledDateStr} is
							still charged unless you cancel your plan first in{" "}
							<Link to="/pricing" className="text-primary underline">
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
							{deletionDateStr} (30 days from now). Your subscription is
							cancelled on that date, so no payment is taken after it. A renewal
							that falls due before {deletionDateStr} is still charged unless you
							cancel your plan first in{" "}
							<Link to="/pricing" className="text-primary underline">
								Billing
							</Link>
							. During this period you can still cancel.
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
