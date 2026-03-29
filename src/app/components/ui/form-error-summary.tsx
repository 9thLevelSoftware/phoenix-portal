import { AlertCircle } from "lucide-react";
import { useFormContext } from "react-hook-form";

/**
 * Displays a summary of all form errors at the top of a form.
 * Place inside a <Form> (react-hook-form FormProvider) wrapper.
 *
 * Interaction design reference: long forms benefit from an error summary
 * that tells users how many errors exist and lets them jump to the first one.
 * Uses aria-live="polite" so screen readers announce when errors appear.
 *
 * Usage:
 *   <Form {...form}>
 *     <FormErrorSummary />
 *     <FormField ... />
 *     <FormField ... />
 *   </Form>
 */
export function FormErrorSummary({ className }: { className?: string }) {
	const {
		formState: { errors, isSubmitted },
	} = useFormContext();

	// Flatten nested errors (e.g., exercises.0.name) into a list of messages
	const errorMessages = flattenErrors(errors);

	// Only show after first submission attempt to avoid premature error display
	if (!isSubmitted || errorMessages.length === 0) return null;

	const scrollToFirstError = () => {
		const firstInvalid = document.querySelector(
			'[aria-invalid="true"]',
		) as HTMLElement | null;
		if (firstInvalid) {
			firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
			firstInvalid.focus();
		}
	};

	return (
		<div
			role="alert"
			aria-live="polite"
			className={`rounded-md border border-destructive/30 bg-destructive/5 p-3 ${className ?? ""}`}
		>
			<button
				type="button"
				onClick={scrollToFirstError}
				className="flex items-center gap-2 text-destructive text-sm font-medium hover:underline w-full text-left"
			>
				<AlertCircle className="w-4 h-4 shrink-0" />
				{errorMessages.length === 1
					? "1 field needs attention"
					: `${errorMessages.length} fields need attention`}
			</button>
			{errorMessages.length <= 5 && (
				<ul className="mt-2 ml-6 list-disc text-sm text-destructive/70 space-y-0.5">
					{errorMessages.map((msg, i) => (
						<li key={i}>{msg}</li>
					))}
				</ul>
			)}
		</div>
	);
}

/** Recursively extract error messages from react-hook-form error objects */
function flattenErrors(errors: Record<string, unknown>, prefix = ""): string[] {
	const messages: string[] = [];

	for (const [key, value] of Object.entries(errors)) {
		if (!value || typeof value !== "object") continue;

		const fieldValue = value as Record<string, unknown>;

		// Leaf error: has a `message` property
		if (typeof fieldValue.message === "string" && fieldValue.message) {
			messages.push(fieldValue.message);
		}
		// Nested object (e.g., field arrays): recurse
		else {
			messages.push(
				...flattenErrors(
					fieldValue as Record<string, unknown>,
					`${prefix}${key}.`,
				),
			);
		}
	}

	return messages;
}
