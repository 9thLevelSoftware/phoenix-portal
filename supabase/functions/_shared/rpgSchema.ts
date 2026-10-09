/**
 * Shared RPG attribute wire contract.
 *
 * The mobile Kotlin side decodes RPG attributes as kotlinx.serialization `Int`.
 * If any portal aggregation path emits a non-integer number (e.g. from an
 * average or ratio), kotlinx.serialization throws on the mobile client.
 *
 * Guard at both boundaries (push write and pull projection) by rounding the
 * integer fields inline: strength, power, stamina, consistency, mastery,
 * level, and experiencePoints / experience_points. Cheaper and more localized
 * than a DB CHECK constraint, and defends against misbehaving producers
 * without requiring a migration.
 *
 * Rounding lives at the call sites (`Math.round` in mobile-sync-push,
 * mobile-sync-pull, and the `rpgInt` transform in pushPayloadSchema.ts).
 *
 * Resolves audit item #8 (2026-04-19).
 */
