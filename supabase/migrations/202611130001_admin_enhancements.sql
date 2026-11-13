-- Youth of Tayitu admin enhancements
-- Applied to Supabase project vroxuvzbnzfelyndchyl on 2026-11-13.

create extension if not exists pg_cron;

create table if not exists public.post_revisions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null,
  actor_user_id uuid,
  actor_email text not null default '',
  revision_action text not null default 'updated',
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists post_revisions_post_created_idx
  on public.post_revisions(post_id, created_at desc);
alter table public.post_revisions enable row level security;
grant select, insert on public.post_revisions to authenticated;
drop policy if exists "Admins can view post revisions" on public.post_revisions;
create policy "Admins can view post revisions"
  on public.post_revisions for select to authenticated
  using (public.is_site_admin());
drop policy if exists "Admins can record post revisions" on public.post_revisions;
create policy "Admins can record post revisions"
  on public.post_revisions for insert to authenticated
  with check (public.is_site_admin() and actor_user_id = auth.uid());

create or replace function public.capture_post_revision()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  insert into public.post_revisions
    (post_id, actor_user_id, actor_email, revision_action, snapshot)
  values (
    old.id,
    auth.uid(),
    coalesce(auth.jwt()->>'email',''),
    case when tg_op='DELETE' then 'deleted' else 'updated' end,
    to_jsonb(old)
  );
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists posts_capture_revision on public.posts;
create trigger posts_capture_revision
  before update or delete on public.posts
  for each row execute function public.capture_post_revision();

create table if not exists public.site_page_views (
  id uuid primary key default gen_random_uuid(),
  page_path text not null check (char_length(page_path) between 1 and 300),
  referrer_host text,
  created_at timestamptz not null default now()
);
create index if not exists site_page_views_created_at_idx
  on public.site_page_views(created_at desc);
create index if not exists site_page_views_path_created_idx
  on public.site_page_views(page_path, created_at desc);
alter table public.site_page_views enable row level security;
grant insert on public.site_page_views to anon, authenticated;
grant select on public.site_page_views to authenticated;
drop policy if exists "Anyone can record anonymous page views" on public.site_page_views;
create policy "Anyone can record anonymous page views"
  on public.site_page_views for insert to anon, authenticated
  with check (
    char_length(page_path) between 1 and 300
    and (referrer_host is null or char_length(referrer_host)<=255)
  );
drop policy if exists "Only owner can read page analytics" on public.site_page_views;
create policy "Only owner can read page analytics"
  on public.site_page_views for select to authenticated
  using (
    exists (
      select 1 from public.admin_users au
      where au.user_id=auth.uid() and au.role='owner'
    )
  );

-- Publishes scheduled posts once their scheduled publication time has passed.
select cron.schedule(
  'youth-tayitu-publish-scheduled-posts',
  '* * * * *',
  $job$
    update public.posts
       set status='published', updated_at=now()
     where status='scheduled'
       and published_at is not null
       and published_at <= now();
  $job$
);
