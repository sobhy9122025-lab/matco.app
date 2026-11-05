-- =========================================================
-- إدارة المستخدمين وإعدادات الدوام من داخل النظام — يُشغَّل مرة واحدة
-- Supabase ← SQL Editor ← New query ← الصق الكود ← Run
-- (يتطلب تشغيل 3_admin_settings.sql قبله)
-- =========================================================

-- ---------- 1) إعدادات النظام (وقت بداية الدوام ودقائق السماح) ----------
create table if not exists public.app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz default now(),
  updated_by text
);

insert into public.app_settings (key, value) values
  ('start_time', '08:00'),
  ('grace_minutes', '15')
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "signed in read settings" on public.app_settings;
create policy "signed in read settings" on public.app_settings
  for select to authenticated using (true);

drop policy if exists "admin write settings" on public.app_settings;
create policy "admin write settings" on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- 2) إدارة المستخدمين (للمدير فقط) ----------
-- قائمة المستخدمين
create or replace function public.admin_list_users()
returns table (email text, created_at timestamptz, last_sign_in_at timestamptz, is_admin boolean)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'هذه العملية مخصّصة للمدير فقط';
  end if;
  return query
    select u.email::text, u.created_at, u.last_sign_in_at,
           exists (select 1 from public.app_admins a where lower(a.email) = lower(u.email))
    from auth.users u
    order by u.created_at;
end;
$$;

-- إضافة مستخدم جديد
create or replace function public.admin_create_user(p_email text, p_password text, p_admin boolean default false)
returns text
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  uid uuid;
  em text := lower(btrim(p_email));
begin
  if not public.is_admin() then
    raise exception 'هذه العملية مخصّصة للمدير فقط';
  end if;
  if em is null or em = '' or position('@' in em) = 0 then
    raise exception 'اسم المستخدم غير صالح';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'كلمة المرور يجب ألا تقل عن 6 أحرف';
  end if;
  if exists (select 1 from auth.users where lower(email) = em) then
    raise exception 'المستخدم % موجود مسبقًا', em;
  end if;

  uid := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    em, extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), uid, uid::text,
    jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true),
    'email', now(), now(), now()
  );
  if p_admin then
    insert into public.app_admins (email) values (em) on conflict (email) do nothing;
  end if;
  return em;
end;
$$;

-- تغيير كلمة المرور
create or replace function public.admin_set_password(p_email text, p_password text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'هذه العملية مخصّصة للمدير فقط';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'كلمة المرور يجب ألا تقل عن 6 أحرف';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where lower(email) = lower(btrim(p_email));
  if not found then
    raise exception 'المستخدم غير موجود';
  end if;
end;
$$;

-- منح صلاحية المدير أو سحبها
create or replace function public.admin_set_admin(p_email text, p_admin boolean)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  em text := lower(btrim(p_email));
begin
  if not public.is_admin() then
    raise exception 'هذه العملية مخصّصة للمدير فقط';
  end if;
  if not p_admin and em = lower(auth.jwt() ->> 'email') then
    raise exception 'لا يمكنك سحب صلاحية المدير من نفسك';
  end if;
  if p_admin then
    insert into public.app_admins (email) values (em) on conflict (email) do nothing;
  else
    delete from public.app_admins where lower(email) = em;
  end if;
end;
$$;

-- حذف مستخدم
create or replace function public.admin_delete_user(p_email text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  em text := lower(btrim(p_email));
begin
  if not public.is_admin() then
    raise exception 'هذه العملية مخصّصة للمدير فقط';
  end if;
  if em = lower(auth.jwt() ->> 'email') then
    raise exception 'لا يمكنك حذف حسابك';
  end if;
  delete from public.app_admins where lower(email) = em;
  delete from auth.identities where user_id in (select id from auth.users where lower(email) = em);
  delete from auth.users where lower(email) = em;
end;
$$;

-- السماح للمستخدمين المسجّلين باستدعاء الدوال (والدالة نفسها تتحقق أنه مدير)
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_create_user(text, text, boolean) from public, anon;
revoke all on function public.admin_set_password(text, text) from public, anon;
revoke all on function public.admin_set_admin(text, boolean) from public, anon;
revoke all on function public.admin_delete_user(text) from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_create_user(text, text, boolean) to authenticated;
grant execute on function public.admin_set_password(text, text) to authenticated;
grant execute on function public.admin_set_admin(text, boolean) to authenticated;
grant execute on function public.admin_delete_user(text) to authenticated;
