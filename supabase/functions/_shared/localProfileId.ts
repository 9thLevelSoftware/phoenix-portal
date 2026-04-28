/**
 * Local profile id validation shared by mobile-sync-push and mobile-sync-pull.
 *
 * The `local_profiles.id` column is TEXT, not UUID
 * (see 20260321120000_local_profile_support.sql — the migration comment
 * explicitly calls out "e.g. 'default'" as a legal id).
 *
 * Mobile (UserProfileRepository.kt) seeds a profile with id = "default"
 * on first boot and prevents deletion of that row, so every sync payload
 * from a real device contains the literal "default" in allProfiles.
 *
 * Profiles created by the user after seeding use UUIDs
 * (generateUUID() in UserProfileRepository.createProfile).
 *
 * Accept both. Reject anything else to block injection.
 */
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PROFILE_ID = "default";

export function isValidLocalProfileId(value: unknown): value is string {
	if (typeof value !== "string") return false;
	if (value === DEFAULT_PROFILE_ID) return true;
	return UUID_REGEX.test(value);
}

export { DEFAULT_PROFILE_ID };
