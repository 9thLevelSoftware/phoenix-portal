import { Check, Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog";

export interface RevealedSecret {
	endpointLabel: string;
	signingSecret: string;
	/** True after a rotation: the previous secret stays valid for a while. */
	rotated: boolean;
}

interface SecretRevealDialogProps {
	secret: RevealedSecret | null;
	onClose: () => void;
}

/**
 * Shows a signing secret the one time the server returns it. The secret is
 * held only in the parent's state and dropped when this closes; it is never
 * written to storage, a query cache or a log.
 */
export function SecretRevealDialog({
	secret,
	onClose,
}: SecretRevealDialogProps) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		if (!secret) return;
		try {
			await navigator.clipboard.writeText(secret.signingSecret);
			setCopied(true);
		} catch {
			toast.error("Could not copy. Select the secret and copy it manually.");
		}
	};

	return (
		<Dialog
			open={secret !== null}
			onOpenChange={(open) => {
				if (!open) {
					setCopied(false);
					onClose();
				}
			}}
		>
			<DialogContent
				// Closing by accident would lose the only copy.
				onInteractOutside={(event) => event.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<KeyRound className="size-5 text-primary" />
						Signing secret for {secret?.endpointLabel}
					</DialogTitle>
					<DialogDescription>
						Copy this secret into your receiver now. It is shown only once: we
						store it encrypted and cannot show it again.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<code
						data-testid="signing-secret"
						className="block w-full select-all break-all rounded-md border border-secondary bg-muted/10 p-3 font-mono text-sm text-foreground"
					>
						{secret?.signingSecret}
					</code>
					<Button
						variant="outline"
						size="sm"
						onClick={() => void handleCopy()}
						className="border-secondary"
					>
						{copied ? (
							<Check className="size-4" />
						) : (
							<Copy className="size-4" />
						)}
						{copied ? "Copied" : "Copy secret"}
					</Button>
					<p className="text-xs text-muted-foreground">
						Your receiver uses it to check the{" "}
						<code className="font-mono">webhook-signature</code> header on every
						delivery (Standard Webhooks format), which proves the delivery came
						from Phoenix Portal and was not altered.
					</p>
					{secret?.rotated && (
						<p className="rounded-md bg-warning/10 p-3 text-xs text-foreground">
							Deliveries are signed with both the new and the previous secret
							for the next 24 hours, so you can switch your receiver over
							without missing any.
						</p>
					)}
				</div>

				<DialogFooter>
					<Button onClick={onClose}>I have saved it</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
