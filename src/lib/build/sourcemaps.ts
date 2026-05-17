export interface SourcemapEnv {
	SENTRY_AUTH_TOKEN?: string;
}

export function shouldUploadSourcemaps(env: SourcemapEnv): boolean {
	return Boolean(env.SENTRY_AUTH_TOKEN?.trim());
}

export function productionSourcemapSetting(
	env: SourcemapEnv,
): false | "hidden" {
	return shouldUploadSourcemaps(env) ? "hidden" : false;
}
