import { type ComponentProps, useEffect, useState } from "react";
import { AvatarImage } from "@/app/components/ui/avatar";
import { avatarObjectPath } from "@/lib/avatar";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

/** Download through RLS on every mount; no reusable signed/public delivery URL. */
export function ProfileAvatarImage({
	source,
	ownerId,
	...props
}: Omit<ComponentProps<typeof AvatarImage>, "src"> & {
	source: string | null | undefined;
	ownerId: string;
}) {
	const { user } = useAuth();
	const viewerId = user?.id;
	const path = avatarObjectPath(source, ownerId);
	const [image, setImage] = useState<{
		source: string | null | undefined;
		viewerId: string;
		url: string;
	} | null>(null);

	useEffect(() => {
		if (!path || !viewerId) return;
		const controller = new AbortController();
		let objectUrl: string | undefined;
		void (async () => {
			try {
				const { data, error } = await supabase.storage
					.from("avatars")
					.download(path, {}, { signal: controller.signal, cache: "no-store" });
				if (controller.signal.aborted || error || !data) return;
				objectUrl = URL.createObjectURL(data);
				setImage({ source, viewerId, url: objectUrl });
			} catch {
				// Denial, missing object or a failed download uses AvatarFallback.
			}
		})();
		return () => {
			controller.abort();
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [path, source, viewerId]);

	if (
		!path ||
		!image ||
		image.source !== source ||
		image.viewerId !== viewerId
	) {
		return null;
	}
	return (
		<AvatarImage {...props} src={image.url} referrerPolicy="no-referrer" />
	);
}
