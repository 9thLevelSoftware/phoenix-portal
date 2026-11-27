import { useEffect, useId, useState } from "react";
import { Button } from "@/app/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Switch } from "@/app/components/ui/switch";
import {
	DATA_SHARING_SCOPE_INFO,
	type DataSharingScope,
	isDataSharingScope,
	type WebhookCustomHeaderInput,
	type WebhookEndpoint,
} from "@/lib/dataSharing";
import {
	WEBHOOK_HEADER_VALUE_MAX,
	WEBHOOK_LABEL_MAX,
	WEBHOOK_URL_MAX,
	webhookEndpointFormSchema,
	webhookFormErrors,
} from "@/schemas/dataSharing";

export interface EndpointFormSubmission {
	label: string;
	url: string;
	scopes: DataSharingScope[];
	/** undefined: leave as is. null: remove. Otherwise set. */
	customHeader: WebhookCustomHeaderInput | null | undefined;
}

interface EndpointFormDialogProps {
	open: boolean;
	/** The endpoint being edited, or null to create one. */
	endpoint: WebhookEndpoint | null;
	isSaving: boolean;
	onSubmit: (values: EndpointFormSubmission) => void;
	onClose: () => void;
}

type FieldErrors = ReturnType<typeof webhookFormErrors>;

export function EndpointFormDialog({
	open,
	endpoint,
	isSaving,
	onSubmit,
	onClose,
}: EndpointFormDialogProps) {
	const formId = useId();
	const [label, setLabel] = useState("");
	const [url, setUrl] = useState("");
	const [scopes, setScopes] = useState<DataSharingScope[]>([]);
	const [headerName, setHeaderName] = useState("");
	const [headerValue, setHeaderValue] = useState("");
	const [removeHeader, setRemoveHeader] = useState(false);
	const [errors, setErrors] = useState<FieldErrors>({});

	// Reset to the endpoint being edited (or to empty) each time it opens. The
	// stored header value is never sent to the browser, so its field starts
	// empty and "leave empty to keep" is the edit default.
	useEffect(() => {
		if (!open) return;
		setLabel(endpoint?.label ?? "");
		setUrl(endpoint?.url ?? "");
		setScopes((endpoint?.scopes ?? []).filter(isDataSharingScope));
		setHeaderName("");
		setHeaderValue("");
		setRemoveHeader(false);
		setErrors({});
	}, [open, endpoint]);

	const existingHeader = endpoint?.custom_header_name ?? null;

	const toggleScope = (scope: DataSharingScope, checked: boolean) => {
		setScopes((current) =>
			checked
				? [...current.filter((entry) => entry !== scope), scope]
				: current.filter((entry) => entry !== scope),
		);
	};

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		const parsed = webhookEndpointFormSchema.safeParse({
			label,
			url: url.trim(),
			scopes,
			headerName: removeHeader ? "" : headerName,
			headerValue: removeHeader ? "" : headerValue,
		});
		if (!parsed.success) {
			setErrors(webhookFormErrors(parsed.error));
			return;
		}
		setErrors({});
		const values = parsed.data;
		let customHeader: EndpointFormSubmission["customHeader"];
		if (removeHeader) customHeader = null;
		else if (values.headerName !== "") {
			customHeader = { name: values.headerName, value: values.headerValue };
		}
		onSubmit({
			label: values.label,
			url: values.url,
			scopes: values.scopes,
			customHeader,
		});
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !isSaving) onClose();
			}}
		>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>
						{endpoint ? "Edit endpoint" : "Add a data sharing endpoint"}
					</DialogTitle>
					<DialogDescription>
						Phoenix Portal sends the data you choose to this address as signed
						JSON, within a minute or two of each change. Only use an endpoint
						you control.
					</DialogDescription>
				</DialogHeader>

				<form
					id={formId}
					onSubmit={handleSubmit}
					className="space-y-5"
					noValidate
				>
					<div className="space-y-2">
						<Label htmlFor={`${formId}-label`}>Name</Label>
						<Input
							id={`${formId}-label`}
							value={label}
							maxLength={WEBHOOK_LABEL_MAX}
							placeholder="Home server"
							aria-invalid={!!errors.label}
							aria-describedby={
								errors.label ? `${formId}-label-error` : undefined
							}
							onChange={(event) => setLabel(event.target.value)}
						/>
						{errors.label && (
							<p
								id={`${formId}-label-error`}
								className="text-sm text-destructive"
							>
								{errors.label}
							</p>
						)}
					</div>

					<div className="space-y-2">
						<Label htmlFor={`${formId}-url`}>Endpoint URL</Label>
						<Input
							id={`${formId}-url`}
							type="url"
							inputMode="url"
							autoComplete="off"
							spellCheck={false}
							value={url}
							maxLength={WEBHOOK_URL_MAX}
							placeholder="https://example.com/phoenix-webhook"
							aria-invalid={!!errors.url}
							aria-describedby={`${formId}-url-help`}
							onChange={(event) => setUrl(event.target.value)}
						/>
						{errors.url ? (
							<p id={`${formId}-url-help`} className="text-sm text-destructive">
								{errors.url}
							</p>
						) : (
							<p
								id={`${formId}-url-help`}
								className="text-xs text-muted-foreground"
							>
								Must be https and reachable from the internet. Redirects are not
								followed.
							</p>
						)}
					</div>

					<fieldset className="space-y-1">
						<legend className="mb-2 text-sm font-medium text-foreground">
							Data to share
						</legend>
						{DATA_SHARING_SCOPE_INFO.map((info) => {
							const switchId = `${formId}-scope-${info.scope}`;
							return (
								<div
									key={info.scope}
									className="flex items-start justify-between gap-4 border-b border-secondary py-2 last:border-b-0"
								>
									<div>
										<Label htmlFor={switchId} className="text-foreground">
											{info.label}
										</Label>
										<p className="text-xs text-muted-foreground">
											{info.description}
										</p>
									</div>
									<Switch
										id={switchId}
										checked={scopes.includes(info.scope)}
										onCheckedChange={(checked) =>
											toggleScope(info.scope, checked)
										}
									/>
								</div>
							);
						})}
						{errors.scopes && (
							<p className="text-sm text-destructive">{errors.scopes}</p>
						)}
					</fieldset>

					<fieldset className="space-y-3">
						<legend className="text-sm font-medium text-foreground">
							Custom header (optional)
						</legend>
						<p className="text-xs text-muted-foreground">
							For receivers that need a key or token on each request and cannot
							check the signature. Sent with every delivery, stored encrypted,
							and never shown again.
						</p>
						{existingHeader && (
							<div className="flex items-center justify-between gap-4 rounded-md border border-secondary p-3">
								<p className="text-sm text-foreground">
									A <code className="font-mono">{existingHeader}</code> header
									is set. Leave the fields below empty to keep it.
								</p>
								<div className="flex items-center gap-2">
									<Label
										htmlFor={`${formId}-remove-header`}
										className="text-xs"
									>
										Remove
									</Label>
									<Switch
										id={`${formId}-remove-header`}
										checked={removeHeader}
										onCheckedChange={setRemoveHeader}
									/>
								</div>
							</div>
						)}
						{!removeHeader && (
							<div className="grid gap-3 sm:grid-cols-2">
								<div className="space-y-2">
									<Label htmlFor={`${formId}-header-name`}>Header name</Label>
									<Input
										id={`${formId}-header-name`}
										value={headerName}
										autoComplete="off"
										spellCheck={false}
										placeholder="Authorization"
										aria-invalid={!!errors.headerName}
										onChange={(event) => setHeaderName(event.target.value)}
									/>
									{errors.headerName && (
										<p className="text-sm text-destructive">
											{errors.headerName}
										</p>
									)}
								</div>
								<div className="space-y-2">
									<Label htmlFor={`${formId}-header-value`}>Header value</Label>
									<Input
										id={`${formId}-header-value`}
										type="password"
										value={headerValue}
										autoComplete="off"
										maxLength={WEBHOOK_HEADER_VALUE_MAX}
										placeholder="Bearer ..."
										aria-invalid={!!errors.headerValue}
										onChange={(event) => setHeaderValue(event.target.value)}
									/>
									{errors.headerValue && (
										<p className="text-sm text-destructive">
											{errors.headerValue}
										</p>
									)}
								</div>
							</div>
						)}
					</fieldset>
				</form>

				<DialogFooter>
					<Button variant="ghost" onClick={onClose} disabled={isSaving}>
						Cancel
					</Button>
					<Button type="submit" form={formId} disabled={isSaving}>
						{isSaving
							? "Saving..."
							: endpoint
								? "Save changes"
								: "Add endpoint"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
