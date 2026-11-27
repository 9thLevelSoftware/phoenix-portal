import { ChevronDown, ChevronUp, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatRelative } from "@/app/components/integrations/formatRelative";
import { DeliveryLog } from "@/app/components/profile/data-sharing/DeliveryLog";
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
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import {
	DATA_SHARING_SCOPE_INFO,
	DataSharingError,
	describeDisabledReason,
	describeTestResult,
	type WebhookEndpoint,
	type WebhookTestResult,
} from "@/lib/dataSharing";
import {
	useDeleteWebhookEndpoint,
	useResendWebhookData,
	useRotateWebhookSecret,
	useTestWebhookEndpoint,
	useUpdateWebhookEndpoint,
} from "@/mutations/dataSharing";

const STATUS_LABEL: Record<WebhookEndpoint["status"], string> = {
	active: "Active",
	paused: "Paused",
	disabled: "Switched off",
};

const STATUS_CLASS: Record<WebhookEndpoint["status"], string> = {
	active: "bg-success/20 text-success",
	paused: "bg-warning/20 text-warning",
	disabled: "bg-destructive/20 text-destructive",
};

const SCOPE_LABEL: Record<string, string> = Object.fromEntries(
	DATA_SHARING_SCOPE_INFO.map((info) => [info.scope, info.label]),
);

type Confirm = "rotate" | "resend" | "delete";

const CONFIRM_COPY: Record<
	Confirm,
	{ title: string; body: string; action: string; pending: string }
> = {
	rotate: {
		title: "Replace the signing secret?",
		body: "A new secret is created and shown once. Deliveries are signed with both secrets for 24 hours, then only the new one, so update your receiver within a day.",
		action: "Replace secret",
		pending: "Replacing...",
	},
	resend: {
		title: "Resend everything?",
		body: "Every existing item in this endpoint's selected data is queued and sent again, one delivery each. A long history can take a while and your receiver will see items it already has.",
		action: "Resend all",
		pending: "Queuing...",
	},
	delete: {
		title: "Delete this endpoint?",
		body: "Nothing more is sent to it. Its signing secret and delivery log are deleted and cannot be recovered.",
		action: "Delete endpoint",
		pending: "Deleting...",
	},
};

interface EndpointCardProps {
	userId: string;
	endpoint: WebhookEndpoint;
	/** FLAME or above. Pausing and deleting stay available without it. */
	canManage: boolean;
	onEdit: (endpoint: WebhookEndpoint) => void;
	onSecret: (endpoint: WebhookEndpoint, signingSecret: string) => void;
}

export function EndpointCard({
	userId,
	endpoint,
	canManage,
	onEdit,
	onSecret,
}: EndpointCardProps) {
	const [confirm, setConfirm] = useState<Confirm | null>(null);
	const [showLog, setShowLog] = useState(false);
	const [testResult, setTestResult] = useState<WebhookTestResult | null>(null);

	const update = useUpdateWebhookEndpoint(userId);
	const rotate = useRotateWebhookSecret(userId);
	const test = useTestWebhookEndpoint(userId);
	const resend = useResendWebhookData(userId);
	const remove = useDeleteWebhookEndpoint(userId);

	const busy =
		update.isPending ||
		rotate.isPending ||
		test.isPending ||
		resend.isPending ||
		remove.isPending;
	const reason = describeDisabledReason(endpoint.disabled_reason);
	const isActive = endpoint.status === "active";

	const handleTest = () => {
		setTestResult(null);
		test.mutate(endpoint.id, { onSuccess: setTestResult });
	};

	const handlePause = () => {
		update.mutate(
			{ endpointId: endpoint.id, status: "paused" },
			{ onSuccess: () => toast.success(`Paused ${endpoint.label}`) },
		);
	};

	const handleResume = () => {
		setTestResult(null);
		update.mutate(
			{ endpointId: endpoint.id, status: "active" },
			{
				onSuccess: () => toast.success(`${endpoint.label} is switched on`),
				onError: (error) => {
					// The server sends one test delivery first; show what it got.
					if (
						error instanceof DataSharingError &&
						error.code === "test_delivery_failed"
					) {
						setTestResult({
							delivered: false,
							statusCode:
								typeof error.details.statusCode === "number"
									? error.details.statusCode
									: null,
							errorCode:
								typeof error.details.errorCode === "string"
									? error.details.errorCode
									: null,
							durationMs: null,
						});
					}
				},
			},
		);
	};

	const runConfirmed = () => {
		if (confirm === "rotate") {
			rotate.mutate(endpoint.id, {
				onSuccess: (result) => {
					setConfirm(null);
					onSecret(result.endpoint, result.signingSecret);
				},
				onError: () => setConfirm(null),
			});
		} else if (confirm === "resend") {
			resend.mutate(endpoint.id, {
				onSuccess: (result) => {
					setConfirm(null);
					toast.success(
						result.enqueued === 0
							? "Nothing new to resend"
							: `Queued ${result.enqueued} deliveries`,
					);
				},
				onError: () => setConfirm(null),
			});
		} else if (confirm === "delete") {
			remove.mutate(endpoint.id, {
				onSuccess: () => {
					setConfirm(null);
					toast.success(`Deleted ${endpoint.label}`);
				},
				onError: () => setConfirm(null),
			});
		}
	};

	const confirmPending =
		rotate.isPending || resend.isPending || remove.isPending;

	return (
		<div
			className="space-y-3 rounded-md border border-secondary p-4"
			data-testid={`webhook-endpoint-${endpoint.id}`}
		>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="font-medium text-foreground">{endpoint.label}</p>
					<p className="break-all font-mono text-xs text-muted-foreground">
						{endpoint.url}
					</p>
				</div>
				<Badge
					className={`border-transparent ${STATUS_CLASS[endpoint.status]}`}
				>
					{STATUS_LABEL[endpoint.status]}
				</Badge>
			</div>

			{reason && (
				<p
					role="status"
					className="rounded-md bg-warning/10 p-3 text-sm text-foreground"
				>
					{reason}
				</p>
			)}

			<div className="flex flex-wrap gap-1.5">
				{endpoint.scopes.map((scope) => (
					<Badge key={scope} variant="outline" className="border-secondary">
						{SCOPE_LABEL[scope] ?? scope}
					</Badge>
				))}
			</div>

			<dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
				<div className="flex gap-1">
					<dt>Signing secret ends in</dt>
					<dd className="font-mono text-foreground">
						{endpoint.signing_key_hint}
					</dd>
				</div>
				<div className="flex gap-1">
					<dt>Custom header:</dt>
					<dd className="font-mono text-foreground">
						{endpoint.custom_header_name ?? "none"}
					</dd>
				</div>
				<div className="flex gap-1">
					<dt>Last delivered:</dt>
					<dd className="text-foreground">
						{formatRelative(endpoint.last_success_at)}
					</dd>
				</div>
				{endpoint.consecutive_failures > 0 && (
					<div className="flex gap-1">
						<dt>Failed attempts in a row:</dt>
						<dd className="text-destructive">
							{endpoint.consecutive_failures}
						</dd>
					</div>
				)}
			</dl>

			{testResult && (
				<p
					role="status"
					className={`text-sm ${testResult.delivered ? "text-success" : "text-destructive"}`}
				>
					{describeTestResult(testResult)}
				</p>
			)}

			<div className="flex flex-wrap gap-2">
				{isActive ? (
					<Button
						size="sm"
						variant="outline"
						className="border-secondary"
						disabled={busy}
						onClick={handlePause}
					>
						Pause
					</Button>
				) : (
					<Button
						size="sm"
						disabled={busy || !canManage}
						onClick={handleResume}
					>
						{update.isPending ? "Checking..." : "Switch on"}
					</Button>
				)}
				<Button
					size="sm"
					variant="outline"
					className="border-secondary"
					disabled={busy || !canManage}
					onClick={handleTest}
				>
					<Send className="size-4" />
					{test.isPending ? "Sending..." : "Send test"}
				</Button>
				<Button
					size="sm"
					variant="outline"
					className="border-secondary"
					disabled={busy || !canManage}
					onClick={() => onEdit(endpoint)}
				>
					Edit
				</Button>
				<Button
					size="sm"
					variant="outline"
					className="border-secondary"
					disabled={busy || !canManage}
					onClick={() => setConfirm("rotate")}
				>
					Replace secret
				</Button>
				<Button
					size="sm"
					variant="outline"
					className="border-secondary"
					disabled={busy || !canManage || !isActive}
					onClick={() => setConfirm("resend")}
				>
					Resend all
				</Button>
				<Button
					size="sm"
					variant="ghost"
					className="text-destructive hover:text-destructive"
					disabled={busy}
					onClick={() => setConfirm("delete")}
				>
					Delete
				</Button>
			</div>

			<div>
				<Button
					size="sm"
					variant="ghost"
					className="px-0 text-muted-foreground"
					aria-expanded={showLog}
					onClick={() => setShowLog((open) => !open)}
				>
					{showLog ? (
						<ChevronUp className="size-4" />
					) : (
						<ChevronDown className="size-4" />
					)}
					Recent deliveries
				</Button>
				{showLog && (
					<div className="mt-2">
						<DeliveryLog userId={userId} endpointId={endpoint.id} />
					</div>
				)}
			</div>

			<AlertDialog
				open={confirm !== null}
				onOpenChange={(open) => {
					if (!open && !confirmPending) setConfirm(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{confirm ? CONFIRM_COPY[confirm].title : ""}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{confirm ? CONFIRM_COPY[confirm].body : ""}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={confirmPending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							className={
								confirm === "delete"
									? "bg-red-600 text-white hover:bg-red-700"
									: undefined
							}
							disabled={confirmPending}
							onClick={(event) => {
								// Keep the dialog open while the request runs and stop a
								// double click from sending it twice.
								event.preventDefault();
								if (confirmPending) return;
								runConfirmed();
							}}
						>
							{confirm
								? confirmPending
									? CONFIRM_COPY[confirm].pending
									: CONFIRM_COPY[confirm].action
								: ""}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
