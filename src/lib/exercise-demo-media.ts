import exerciseDumpRaw from "../../supabase/seed-data/exercise_dump.json?raw";

export interface ExerciseDemoMedia {
	angle: string | null;
	thumbnailUrl: string;
	videoUrl: string;
}

interface RawExerciseDumpItem {
	id?: unknown;
	videos?: unknown;
}

interface RawExerciseVideo {
	angle?: unknown;
	thumbnail?: unknown;
	video?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseExerciseDump(raw: string): RawExerciseDumpItem[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
	} catch {
		return [];
	}
}

function normalizeVideo(video: unknown): ExerciseDemoMedia | null {
	if (!isRecord(video)) return null;

	const rawVideo = video as RawExerciseVideo;
	if (
		typeof rawVideo.video !== "string" ||
		typeof rawVideo.thumbnail !== "string"
	) {
		return null;
	}

	return {
		angle: typeof rawVideo.angle === "string" ? rawVideo.angle : null,
		thumbnailUrl: rawVideo.thumbnail,
		videoUrl: rawVideo.video,
	};
}

function buildExerciseMediaIndex(
	exerciseDump: RawExerciseDumpItem[],
): Map<string, ExerciseDemoMedia[]> {
	const mediaByExerciseId = new Map<string, ExerciseDemoMedia[]>();

	for (const exercise of exerciseDump) {
		if (typeof exercise.id !== "string" || !Array.isArray(exercise.videos)) {
			continue;
		}

		const media = exercise.videos
			.map((video) => normalizeVideo(video))
			.filter((video): video is ExerciseDemoMedia => video !== null);

		if (media.length > 0) {
			mediaByExerciseId.set(exercise.id, media);
		}
	}

	return mediaByExerciseId;
}

const mediaByExerciseId = buildExerciseMediaIndex(
	parseExerciseDump(exerciseDumpRaw),
);

export function getExerciseDemoMedia(
	exerciseId: string | null | undefined,
): ExerciseDemoMedia[] {
	if (!exerciseId) return [];
	return mediaByExerciseId.get(exerciseId) ?? [];
}

export function getPrimaryExerciseDemoMedia(
	exerciseId: string | null | undefined,
): ExerciseDemoMedia | null {
	return getExerciseDemoMedia(exerciseId)[0] ?? null;
}
