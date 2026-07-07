ALTER TABLE public.training_cycles
  ADD COLUMN IF NOT EXISTS template_id TEXT;
