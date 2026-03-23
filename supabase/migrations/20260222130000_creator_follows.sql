-- Creator follows table for community follow/unfollow feature
create table if not exists creator_follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references auth.users(id) on delete cascade,
  followed_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(follower_id, followed_id),
  check (follower_id != followed_id)
);

-- RLS
alter table creator_follows enable row level security;

drop policy if exists "Users can view follows" on creator_follows;
create policy "Users can view follows"
  on creator_follows for select
  using (true);

drop policy if exists "Users can follow others" on creator_follows;
create policy "Users can follow others"
  on creator_follows for insert
  with check (auth.uid() = follower_id);

drop policy if exists "Users can unfollow" on creator_follows;
create policy "Users can unfollow"
  on creator_follows for delete
  using (auth.uid() = follower_id);

-- Index for fast lookups
create index if not exists idx_creator_follows_follower on creator_follows(follower_id);
create index if not exists idx_creator_follows_followed on creator_follows(followed_id);
