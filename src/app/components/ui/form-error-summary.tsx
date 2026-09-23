import { AlertCircle } from "lucide-react";
import { useFormContext } from "react-hook-form";

interface FormErrorSummaryProps {
	className?: string;
	/** Use when the host form has validation errors outside react-hook-form. */
	messages?: string[];
}

/**
 * Displays a summary of all form errors at the top of a form.
 * Place inside a <Form> (react-hook-form FormProvider) wrapper, or pass
 * `messages` when adapting another form state implementation.
 */
export function FormErrorSummary({
	className,
	messages,
}: FormErrorSummaryProps) {
	if (messages !== undefined) {
		return <ErrorSummary messages={messages} className={className} />;
	}

	return <ReactHookFormErrorSummary className={className} />;
}

function ReactHookFormErrorSummary({ className }: { className?: string }) {
	const {
		formState: { errors, isSubmitted },
	} = useFormContext();

	const errorMessages = flattenErrors(errors);
	if (!isSubmitted || errorMessages.length === 0) return null;

	return <ErrorSummary messages={errorMessages} className={className} />;
}

function ErrorSummary({
	messages,
	className,
}: {
	messages: string[];
	className?: string;
}) {
	if (messages.length === 0) return null;

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
				{messages.length === 1
					? "1 field needs attention"
					: `${messages.length} fields need attention`}
			</button>
			{messages.length <= 5 && (
				<ul className="mt-2 ml-6 list-disc text-sm text-destructive/70 space-y-0.5">
					{messages.map((message, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: error messages may duplicate, index is the only stable key
						<li key={i}>{message}</li>
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

		if (typeof fieldValue.message === "string" && fieldValue.message) {
			messages.push(fieldValue.message);
		} else {
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
