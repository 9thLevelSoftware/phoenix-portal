import { z } from "zod";
import { DATA_SHARING_SCOPES } from "@/lib/dataSharing";

/**
 * The data sharing endpoint form. These checks are for instant feedback only:
 * `webhook-endpoints` validates again and is the authority. In particular the
 * server also resolves the host and refuses private or reserved addresses,
 * which the browser cannot check. Keep the rules here no stricter than
 * `supabase/functions/_shared/webhookTarget.ts`, or the form would reject a
 * URL the server accepts.
 */

export const WEBHOOK_LABEL_MAX = 80;
export const WEBHOOK_URL_MAX = 2048;
export const WEBHOOK_HEADER_VALUE_MAX = 512;

const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const HEADER_VALUE = /^[\x20-\x7E]+$/;

function checkUrl(value: string): string | null {
	if (/\s/.test(value)) return "Enter a valid URL.";
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return "Enter a valid URL.";
	}
	if (url.protocol !== "https:") return "The URL must start with https://.";
	if (url.username !== "" || url.password !== "") {
		return "The URL must not contain a username or password. Use the custom header instead.";
	}
	return null;
}

export const webhookEndpointFormSchema = z
	.object({
		label: z
			.string()
			.trim()
			.min(1, "Give the endpoint a name.")
			.max(WEBHOOK_LABEL_MAX, `Use at most ${WEBHOOK_LABEL_MAX} characters.`),
		url: z
			.string()
			.min(1, "Enter the URL to send your data to.")
			.max(WEBHOOK_URL_MAX, `Use at most ${WEBHOOK_URL_MAX} characters.`),
		scopes: z
			.array(z.enum(DATA_SHARING_SCOPES))
			.min(1, "Choose at least one kind of data to share."),
		headerName: z.string().trim(),
		headerValue: z.string(),
	})
	.superRefine((form, ctx) => {
		const urlProblem = form.url ? checkUrl(form.url) : null;
		if (urlProblem) {
			ctx.addIssue({ code: "custom", path: ["url"], message: urlProblem });
		}
		// The header is optional, but a name and a value go together.
		if (form.headerName === "" && form.headerValue === "") return;
		if (!HEADER_NAME.test(form.headerName)) {
			ctx.addIssue({
				code: "custom",
				path: ["headerName"],
				message:
					"Use letters, digits and hyphens, starting with a letter (for example Authorization).",
			});
		}
		if (
			form.headerValue.length === 0 ||
			form.headerValue.length > WEBHOOK_HEADER_VALUE_MAX ||
			!HEADER_VALUE.test(form.headerValue)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["headerValue"],
				message: `Enter 1 to ${WEBHOOK_HEADER_VALUE_MAX} printable characters.`,
			});
		}
	});

export type WebhookEndpointFormValues = z.infer<
	typeof webhookEndpointFormSchema
>;

/** The first message per field, for showing beside each input. */
export function webhookFormErrors(
	error: z.ZodError,
): Partial<Record<keyof WebhookEndpointFormValues, string>> {
	const messages: Partial<Record<keyof WebhookEndpointFormValues, string>> = {};
	for (const issue of error.issues) {
		const field = issue.path[0] as keyof WebhookEndpointFormValues | undefined;
		if (field && !(field in messages)) messages[field] = issue.message;
	}
	return messages;
}
