const PHOENIX_STORAGE_ORIGIN = "https://api.phoenix-portal.com";
const LEGACY_STORAGE_ORIGIN = "https://ilzlswmatadlnsuxatcv.supabase.co";
const AVATAR_PATH = "/storage/v1/object/public/avatars/";

/** Treat a stored URL as a reference only; never fetch its origin. */
export function avatarObjectPath(
	source: string | null | undefined,
	ownerId: string,
	storageOrigin = import.meta.env.VITE_SUPABASE_URL,
): string | null {
	if (!source || ownerId.length !== 36 || !/^[0-9a-f-]{36}$/.test(ownerId))
		return null;
	const origins = [
		PHOENIX_STORAGE_ORIGIN,
		LEGACY_STORAGE_ORIGIN,
		storageOrigin,
	];
	for (const origin of origins) {
		if (!origin) continue;
		const prefix = `${origin}${AVATAR_PATH}${ownerId}/`;
		if (!source.startsWith(prefix)) continue;
		const filename = source.slice(prefix.length);
		if (
			/\s/.test(filename) ||
			!/^avatar\.[A-Za-z0-9_-]{1,32}(\?t=\d+)?$/.test(filename)
		) {
			return null;
		}
		return `${ownerId}/${filename.split("?")[0]}`;
	}
	return null;
}

export function avatarSource(ownerId: string, extension: string): string {
	return `${PHOENIX_STORAGE_ORIGIN}${AVATAR_PATH}${ownerId}/avatar.${extension}?t=${Date.now()}`;
}

export const AVATAR_FILE_EXTENSIONS: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
	"image/avif": "avif",
};
