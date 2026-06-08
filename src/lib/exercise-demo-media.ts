import { EXERCISE_DEMO_MEDIA } from "@/lib/exercise-demo-media-manifest";

export interface ExerciseDemoMedia {
	angle: string | null;
	thumbnailUrl: string;
	videoUrl: string;
}

type ExerciseDemoMediaManifest = Record<string, readonly ExerciseDemoMedia[]>;

const mediaByExerciseId = EXERCISE_DEMO_MEDIA as ExerciseDemoMediaManifest;

export function getExerciseDemoMedia(
	exerciseId: string | null | undefined,
): ExerciseDemoMedia[] {
	if (!exerciseId) return [];
	return [...(mediaByExerciseId[exerciseId] ?? [])];
}

export function getPrimaryExerciseDemoMedia(
	exerciseId: string | null | undefined,
): ExerciseDemoMedia | null {
	return getExerciseDemoMedia(exerciseId)[0] ?? null;
}
