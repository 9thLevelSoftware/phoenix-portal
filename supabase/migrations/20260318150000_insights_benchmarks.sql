-- Analytics Enhancement: insights and community benchmarks tables

-- 1. user_insights — cached training insights from rule engine
CREATE TABLE IF NOT EXISTS user_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL CHECK (insight_type IN ('success', 'warning', 'info', 'achievement')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  recommendation TEXT,
  metric_name TEXT,
  metric_value NUMERIC,
  metric_unit TEXT,
  metric_delta NUMERIC,
  period TEXT NOT NULL DEFAULT '30d',
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

ALTER TABLE user_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own insights"
  ON user_insights FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role can manage insights"
  ON user_insights FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE INDEX idx_user_insights_user ON user_insights(user_id, created_at DESC);

-- 2. community_benchmarks — aggregated percentile data
CREATE TABLE IF NOT EXISTS community_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_type TEXT NOT NULL,
  metric_key TEXT,
  percentile_values JSONB NOT NULL DEFAULT '{}',
  total_users INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE community_benchmarks ENABLE ROW LEVEL SECURITY;

-- Benchmarks are public read (anonymized aggregate data)
CREATE POLICY "Anyone can read benchmarks"
  ON community_benchmarks FOR SELECT USING (true);
CREATE POLICY "Service role can manage benchmarks"
  ON community_benchmarks FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE UNIQUE INDEX idx_community_benchmarks_metric
  ON community_benchmarks(metric_type, COALESCE(metric_key, ''));
