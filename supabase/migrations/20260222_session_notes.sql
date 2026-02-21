-- Add notes column to workout_sessions for per-session user notes
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS notes TEXT;

-- Allow users to update their own sessions (needed for saving notes)
CREATE POLICY "Users can update own sessions"
  ON workout_sessions FOR UPDATE USING (auth.uid() = user_id);
