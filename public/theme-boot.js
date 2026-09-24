// Pre-paint theme: runs synchronously before the stylesheet so the first frame
// already uses the stored theme (no dark-to-light flash). It is a same-origin
// file rather than an inline <script> so it passes the script-src CSP (the
// report-only policy has no 'unsafe-inline'). Keep in sync with
// src/providers/ThemeProvider.tsx (storage key and accepted values).
(() => {
	var resolved = "dark";
	try {
		var stored = localStorage.getItem("phoenix-theme");
		if (stored === "light") resolved = "light";
		else if (stored === "system")
			resolved = window.matchMedia("(prefers-color-scheme: light)").matches
				? "light"
				: "dark";
	} catch (_error) {
		// Storage blocked: keep the dark default.
	}
	document.documentElement.dataset.theme = resolved;
	var meta = document.querySelector('meta[name="color-scheme"]');
	if (meta) meta.setAttribute("content", resolved);
})();
