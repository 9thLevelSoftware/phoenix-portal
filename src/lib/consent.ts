export type ConsentStatus = "accepted" | "rejected" | null;

const STORAGE_KEY = "phoenix-cookie-consent";

export function getConsentStatus(): ConsentStatus {
	const value = localStorage.getItem(STORAGE_KEY);
	if (value === "accepted" || value === "rejected") {
		return value;
	}
	return null;
}

export function setConsentStatus(status: "accepted" | "rejected"): void {
	localStorage.setItem(STORAGE_KEY, status);
}
