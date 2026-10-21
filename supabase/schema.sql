-- Discussion board schema for Supabase.
-- Intended for a public link-based meeting board without sign-in.
-- Anyone with a board URL can read and edit public agenda topics. Use Supabase Auth
-- and stricter policies before storing confidential or sensitive meeting content.

create extension if not exists pgcrypto;

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  board text not null default 'team-meeting' check (char_length(board) between 1 and 40),
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 800),
  author text,
  status text not null default 'to_discuss'
    check (status in ('to_discuss', 'discussing', 'discussed')),
  votes integer not null default 0 check (votes >= 0),
  sort_order double precision not null default (extract(epoch from now()) * 1000),
  created_at timestamptz not null default now()
);
alter table public.topics add column if not exists board text not null default 'team-meeting';
alter table public.topics drop constraint if exists topics_board_length;
alter table public.topics add constraint topics_board_length check (char_length(board) between 1 and 40);
alter table public.topics add column if not exists description text;
alter table public.topics add column if not exists author text;
alter table public.topics add column if not exists status text not null default 'to_discuss';
alter table public.topics add column if not exists votes integer not null default 0;
alter table public.topics add column if not exists sort_order double precision not null default (extract(epoch from now()) * 1000);
alter table public.topics add column if not exists created_at timestamptz not null default now();

create table if not exists public.topic_votes (
  topic_id uuid not null references public.topics(id) on delete cascade,
  voter_id text not null check (char_length(voter_id) between 8 and 64),
  created_at timestamptz not null default now(),
  primary key (topic_id, voter_id)
);

create table if not exists public.timers (
  board text primary key check (char_length(board) between 1 and 40),
  duration_seconds integer not null default 300 check (duration_seconds between 1 and 7200),
  remaining_seconds integer default 300 check (remaining_seconds is null or remaining_seconds between 0 and 7200),
  ends_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.topics enable row level security;
alter table public.topic_votes enable row level security;
alter table public.timers enable row level security;

grant select, insert, update, delete on public.topics to anon, authenticated;
grant select, insert, delete on public.topic_votes to anon, authenticated;
grant select on public.timers to anon, authenticated;

drop policy if exists "topics open access" on public.topics;
create policy "topics open access" on public.topics
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "votes read" on public.topic_votes;
create policy "votes read" on public.topic_votes
  for select to anon, authenticated using (true);
drop policy if exists "votes insert" on public.topic_votes;
create policy "votes insert" on public.topic_votes
  for insert to anon, authenticated with check (true);
drop policy if exists "votes delete" on public.topic_votes;
create policy "votes delete" on public.topic_votes
  for delete to anon, authenticated using (true);

drop policy if exists "timers read" on public.timers;
create policy "timers read" on public.timers
  for select to anon, authenticated using (true);

-- Keep topic vote totals accurate, including concurrent users and vote removals.
create or replace function public.refresh_topic_vote_count()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  changed_topic uuid;
begin
  changed_topic := coalesce(new.topic_id, old.topic_id);
  update public.topics
     set votes = (select count(*)::integer from public.topic_votes where topic_id = changed_topic)
   where id = changed_topic;
  return null;
end;
$$;

-- Remove the older increment/decrement trigger if this schema is applied to an existing board.
drop trigger if exists topic_votes_sync on public.topic_votes;
drop trigger if exists refresh_topic_vote_count_after_change on public.topic_votes;
revoke all on function public.sync_topic_votes() from public, anon, authenticated;
drop function if exists public.sync_topic_votes();

create trigger refresh_topic_vote_count_after_change
after insert or delete on public.topic_votes
for each row execute function public.refresh_topic_vote_count();

-- Timer RPCs mutate the timer on behalf of public clients. They have a fixed search_path
-- and operate only on the board key supplied in the request.
create or replace function public.timer_start(p_board text, p_seconds integer default null)
returns public.timers
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.timers;
begin
  if p_board is null or char_length(p_board) not between 1 and 40 then
    raise exception 'Board name must be between 1 and 40 characters';
  end if;
  insert into public.timers (board) values (p_board) on conflict (board) do nothing;
  select * into t from public.timers where board = p_board for update;
  if p_seconds is not null then
    t.duration_seconds := greatest(1, least(p_seconds, 7200));
    t.remaining_seconds := t.duration_seconds;
    t.ends_at := null;
  end if;
  if t.ends_at is null then
    t.ends_at := now() + make_interval(secs => coalesce(t.remaining_seconds, t.duration_seconds));
    t.remaining_seconds := null;
  end if;
  update public.timers set duration_seconds=t.duration_seconds, remaining_seconds=t.remaining_seconds,
    ends_at=t.ends_at, updated_at=now() where board=p_board returning * into t;
  return t;
end;
$$;

create or replace function public.timer_pause(p_board text)
returns public.timers
language plpgsql
security definer
set search_path = public
as $$
declare t public.timers;
begin
  if p_board is null or char_length(p_board) not between 1 and 40 then
    raise exception 'Board name must be between 1 and 40 characters';
  end if;
  insert into public.timers (board) values (p_board) on conflict (board) do nothing;
  select * into t from public.timers where board=p_board for update;
  if t.ends_at is not null then
    t.remaining_seconds := greatest(0, ceil(extract(epoch from (t.ends_at-now()))))::integer;
    t.ends_at := null;
  end if;
  update public.timers set remaining_seconds=t.remaining_seconds, ends_at=t.ends_at,
    updated_at=now() where board=p_board returning * into t;
  return t;
end;
$$;

create or replace function public.timer_reset(p_board text, p_seconds integer default null)
returns public.timers
language plpgsql
security definer
set search_path = public
as $$
declare t public.timers;
begin
  if p_board is null or char_length(p_board) not between 1 and 40 then
    raise exception 'Board name must be between 1 and 40 characters';
  end if;
  insert into public.timers (board) values (p_board) on conflict (board) do nothing;
  select * into t from public.timers where board=p_board for update;
  if p_seconds is not null then t.duration_seconds := greatest(1, least(p_seconds, 7200)); end if;
  update public.timers set duration_seconds=t.duration_seconds, remaining_seconds=t.duration_seconds,
    ends_at=null, updated_at=now() where board=p_board returning * into t;
  return t;
end;
$$;

create or replace function public.timer_add(p_board text, p_seconds integer)
returns public.timers
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.timers;
  delta integer := greatest(-3600, least(coalesce(p_seconds, 0), 3600));
begin
  if p_board is null or char_length(p_board) not between 1 and 40 then
    raise exception 'Board name must be between 1 and 40 characters';
  end if;
  insert into public.timers (board) values (p_board) on conflict (board) do nothing;
  select * into t from public.timers where board=p_board for update;
  if t.ends_at is not null then
    t.ends_at := greatest(t.ends_at, now()) + make_interval(secs => delta);
  else
    t.remaining_seconds := greatest(0, coalesce(t.remaining_seconds, t.duration_seconds) + delta);
  end if;
  t.duration_seconds := greatest(1, least(t.duration_seconds + delta, 7200));
  update public.timers set duration_seconds=t.duration_seconds, remaining_seconds=t.remaining_seconds,
    ends_at=t.ends_at, updated_at=now() where board=p_board returning * into t;
  return t;
end;
$$;

revoke all on function public.timer_start(text, integer) from public;
revoke all on function public.timer_pause(text) from public;
revoke all on function public.timer_reset(text, integer) from public;
revoke all on function public.timer_add(text, integer) from public;
grant execute on function public.timer_start(text, integer) to anon, authenticated;
grant execute on function public.timer_pause(text) to anon, authenticated;
grant execute on function public.timer_reset(text, integer) to anon, authenticated;
grant execute on function public.timer_add(text, integer) to anon, authenticated;

create index if not exists topics_status_sort_order_idx on public.topics(status, sort_order);
create index if not exists topics_board_status_sort_order_idx on public.topics(board, status, sort_order);
create index if not exists topic_votes_topic_id_idx on public.topic_votes(topic_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='topics'
  ) then execute 'alter publication supabase_realtime add table public.topics'; end if;
  if not exists (
    select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='topic_votes'
  ) then execute 'alter publication supabase_realtime add table public.topic_votes'; end if;
  if not exists (
    select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='timers'
  ) then execute 'alter publication supabase_realtime add table public.timers'; end if;
end $$;
