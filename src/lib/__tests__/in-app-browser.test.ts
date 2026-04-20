import { describe, expect, it } from "vitest";
import {
	buildAndroidChromeIntentUrl,
	detectInAppBrowser,
} from "../in-app-browser";

describe("detectInAppBrowser", () => {
	it.each([
		[
			"Reddit Android",
			"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Reddit/Version 2024.40.1/Build 1",
			"reddit",
			"android",
		],
		[
			"Reddit iOS",
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Reddit/2024.40.0",
			"reddit",
			"ios",
		],
		[
			"Instagram iOS",
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Instagram 300.0.0.0.0 (iPhone14,2; iOS 17_2; en_US)",
			"instagram",
			"ios",
		],
		[
			"Facebook Android",
			"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.0;]",
			"facebook",
			"android",
		],
		[
			"Messenger iOS",
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 [FBAN/MessengerForiOS;FBAV/440.0.0;FBBV/1;FB_IAB/MESSENGER;]",
			"messenger",
			"ios",
		],
		[
			"TikTok Android",
			"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36 BytedanceWebview/d8a21c6",
			"tiktok",
			"android",
		],
		[
			"Twitter/X Android",
			"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36 TwitterAndroid",
			"twitter",
			"android",
		],
		[
			"LinkedIn iOS",
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 LinkedInApp/9.30.1",
			"linkedin",
			"ios",
		],
		[
			"WeChat Android",
			"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 MicroMessenger/8.0.42",
			"wechat",
			"android",
		],
		[
			"Google App iOS",
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 GSA/300.0.553234547",
			"google-app",
			"ios",
		],
		[
			"Generic Android WebView",
			"Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
			"webview",
			"android",
		],
	])("detects %s as in-app browser", (_label, ua, expectedBrowser, expectedPlatform) => {
		const result = detectInAppBrowser(ua);
		expect(result.isInAppBrowser).toBe(true);
		expect(result.browser).toBe(expectedBrowser);
		expect(result.platform).toBe(expectedPlatform);
	});

	it.each([
		[
			"Chrome Android",
			"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
			"android",
		],
		[
			"Safari iOS",
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
			"ios",
		],
		[
			"Chrome iOS",
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1",
			"ios",
		],
		[
			"Firefox desktop",
			"Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
			"other",
		],
		[
			"Edge desktop",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
			"other",
		],
	])("treats %s as a real browser", (_label, ua, expectedPlatform) => {
		const result = detectInAppBrowser(ua);
		expect(result.isInAppBrowser).toBe(false);
		expect(result.browser).toBeNull();
		expect(result.platform).toBe(expectedPlatform);
	});
});

describe("buildAndroidChromeIntentUrl", () => {
	it("builds an intent URL that targets Chrome for an https URL", () => {
		const result = buildAndroidChromeIntentUrl(
			"https://phoenix-portal.com/dashboard?ref=reddit#top",
		);
		expect(result).toBe(
			"intent://phoenix-portal.com/dashboard?ref=reddit#top#Intent;scheme=https;package=com.android.chrome;end",
		);
	});

	it("returns null for unsupported schemes", () => {
		expect(buildAndroidChromeIntentUrl("javascript:alert(1)")).toBeNull();
		expect(buildAndroidChromeIntentUrl("")).toBeNull();
	});

	it("returns null for malformed URLs", () => {
		expect(buildAndroidChromeIntentUrl("not a url")).toBeNull();
	});
});
