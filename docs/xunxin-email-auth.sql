-- Run after docs/account-supabase.sql. Only the server service role may use these objects.
create table if not exists public.xunxin_email_codes (
  email text not null,
  purpose text not null check (purpose in ('register', 'login')),
  code_hash text not null,
  expires_at timestamptz not null,
  sent_at timestamptz not null default now(),
  attempts integer not null default 0,
  primary key (email, purpose)
);
create table if not exists public.xunxin_email_rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  count integer not null
);
alter table public.xunxin_email_codes enable row level security;
alter table public.xunxin_email_rate_limits enable row level security;
revoke all on public.xunxin_email_codes, public.xunxin_email_rate_limits from public, anon, authenticated;

create or replace function public.xunxin_issue_email_code(p_email text, p_purpose text, p_hash text, p_ip_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count integer; v_changed integer;
begin
  if p_purpose not in ('register', 'login') then return false; end if;
  -- Shared across application instances; at most 20 requests per IP per hour.
  insert into public.xunxin_email_rate_limits as r (bucket, window_start, count)
    values (p_ip_hash, now(), 1)
    on conflict (bucket) do update set
      window_start = case when r.window_start < now() - interval '1 hour' then now() else r.window_start end,
      count = case when r.window_start < now() - interval '1 hour' then 1 else r.count + 1 end
    returning count into v_count;
  if v_count > 20 then return false; end if;
  insert into public.xunxin_email_codes as c (email, purpose, code_hash, expires_at, sent_at, attempts)
    values (p_email, p_purpose, p_hash, now() + interval '10 minutes', now(), 0)
    on conflict (email, purpose) do update set code_hash = excluded.code_hash,
      expires_at = excluded.expires_at, sent_at = excluded.sent_at, attempts = 0
      where c.sent_at < now() - interval '60 seconds';
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end $$;

create or replace function public.xunxin_use_email_code(
  p_email text, p_purpose text, p_hash text, p_user_id text, p_password_hash text
) returns text language plpgsql security definer set search_path = public as $$
declare v_code public.xunxin_email_codes; v_user public.app_users;
begin
  select * into v_code from public.xunxin_email_codes
    where email = p_email and purpose = p_purpose for update;
  if not found or v_code.expires_at <= now() or v_code.attempts >= 5 then return 'invalid'; end if;
  if v_code.code_hash <> p_hash then
    update public.xunxin_email_codes set attempts = attempts + 1 where email = p_email and purpose = p_purpose;
    return 'invalid';
  end if;
  if p_purpose = 'register' then
    insert into public.app_users (id, username, password_hash, display_name, status, activated_at, last_login_at)
      values (p_user_id, p_email, p_password_hash, p_email, 'active', now(), now())
      on conflict (username) do nothing returning * into v_user;
    if not found then return 'exists'; end if;
  elsif p_purpose = 'login' then
    select * into v_user from public.app_users where username = p_email;
    if not found then return 'missing'; end if;
    if v_user.status <> 'active' then return 'disabled'; end if;
  else return 'invalid';
  end if;
  delete from public.xunxin_email_codes where email = p_email and purpose = p_purpose;
  return v_user.id;
end $$;
revoke all on function public.xunxin_issue_email_code(text,text,text,text) from public, anon, authenticated;
revoke all on function public.xunxin_use_email_code(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.xunxin_issue_email_code(text,text,text,text) to service_role;
grant execute on function public.xunxin_use_email_code(text,text,text,text,text) to service_role;
