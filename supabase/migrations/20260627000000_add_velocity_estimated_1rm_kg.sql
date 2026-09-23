-- Issue #517 Phase 6: velocity-based (VBT) estimated 1RM display.
--
-- Add a brand-new, nullable, additive column alongside the existing rep-based
-- estimated_1rm_kg. The mobile app is authoritative for this value (computed
-- on-device from BLE mean concentric velocity); the portal stores it verbatim
-- and never recomputes. Per-cable kg, like estimated_1rm_kg (portal applies the
-- x2 display multiplier in the UI). Legacy rows/payloads without it stay NULL
-- and simply show no velocity metric — estimated_1rm_kg is never touched.
ALTER TABLE public.exercise_progress
  ADD COLUMN IF NOT EXISTS velocity_estimated_1rm_kg numeric;
