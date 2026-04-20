export type InAppBrowser =
	| "reddit"
	| "instagram"
	| "facebook"
	| "messenger"
	| "tiktok"
	| "twitter"
	| "linkedin"
	| "snapchat"
	| "pinterest"
	| "line"
	| "wechat"
	| "discord"
	| "slack"
	| "google-app"
	| "webview";

export type DevicePlatform = "ios" | "android" | "other";

export interface InAppBrowserDetection {
	isInAppBrowser: boolean;
	browser: InAppBrowser | null;
	platform: DevicePlatform;
}

const PATTERNS: ReadonlyArray<{ regex: RegExp; name: InAppBrowser }> = [
	{ regex: /\bInstagram\b/i, name: "instagram" },
	{ regex: /\bMessenger\b|FB_IAB.*MESSENGER/i, name: "messenger" },
	{ regex: /FBAN|FBAV|FB_IAB/i, name: "facebook" },
	{ regex: /Reddit/i, name: "reddit" },
	{ regex: /TikTok|musical_ly|Bytedance/i, name: "tiktok" },
	{ regex: /Twitter|TwitterAndroid/i, name: "twitter" },
	{ regex: /LinkedInApp/i, name: "linkedin" },
	{ regex: /Snapchat/i, name: "snapchat" },
	{ regex: /Pinterest/i, name: "pinterest" },
	{ regex: /\bLine\//i, name: "line" },
	{ regex: /MicroMessenger/i, name: "wechat" },
	{ regex: /Discord/i, name: "discord" },
	{ regex: /\bSlack\b/i, name: "slack" },
	{ regex: /\bGSA\//i, name: "google-app" },
];

function detectPlatform(userAgent: string): DevicePlatform {
	if (/Android/i.test(userAgent)) return "android";
	if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
	return "other";
}

export function detectInAppBrowser(
	userAgent: string = typeof navigator !== "undefined"
		? navigator.userAgent
		: "",
): InAppBrowserDetection {
	const platform = detectPlatform(userAgent);

	for (const { regex, name } of PATTERNS) {
		if (regex.test(userAgent)) {
			return { isInAppBrowser: true, browser: name, platform };
		}
	}

	// Generic Android WebView token (does not trigger on Chrome/Firefox/Samsung Internet)
	if (/; wv\)/i.test(userAgent)) {
		return { isInAppBrowser: true, browser: "webview", platform };
	}

	return { isInAppBrowser: false, browser: null, platform };
}

/**
 * Builds an Android `intent://` URL that forces the link to open in Chrome,
 * bypassing the host app's embedded WebView. iOS has no equivalent API.
 */
export function buildAndroidChromeIntentUrl(
	url: string = typeof window !== "undefined" ? window.location.href : "",
): string | null {
	if (!url) return null;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
	const scheme = parsed.protocol.replace(":", "");
	const rest = `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
	return `intent://${rest}#Intent;scheme=${scheme};package=com.android.chrome;end`;
}

const BROWSER_LABELS: Record<InAppBrowser, string> = {
	reddit: "Reddit",
	instagram: "Instagram",
	facebook: "Facebook",
	messenger: "Messenger",
	tiktok: "TikTok",
	twitter: "X",
	linkedin: "LinkedIn",
	snapchat: "Snapchat",
	pinterest: "Pinterest",
	line: "LINE",
	wechat: "WeChat",
	discord: "Discord",
	slack: "Slack",
	"google-app": "the Google app",
	webview: "this app",
};

export function getInAppBrowserLabel(browser: InAppBrowser): string {
	return BROWSER_LABELS[browser];
}
