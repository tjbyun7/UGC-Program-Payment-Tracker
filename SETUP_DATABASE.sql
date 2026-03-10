-- Run this in your Supabase SQL Editor
-- Go to: SQL Editor → New Query → paste this → Run

create table if not exists ugc_creators (
  id bigint primary key,
  name text,
  handle text,
  email text,
  avatar_color text,
  joined_date date,
  videos_json jsonb default '[]'::jsonb
);

-- Allow public read/write (fine for internal tools)
alter table ugc_creators enable row level security;

create policy "Allow all" on ugc_creators
  for all using (true) with check (true);
