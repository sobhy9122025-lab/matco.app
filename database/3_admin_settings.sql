-- =========================================================
-- صلاحيات صفحة "الإعدادات" (للمدير فقط) — يتشغّل مرة واحدة
-- Supabase ← SQL Editor ← New query ← الصق الكود ← Run
--
-- المدير هو اللي يقدر يرفع ملف الموظفين ويحدّث بياناتهم.
-- عشان تضيف مدير تاني: زوّد سطر في الـ insert اللي تحت بإيميله وشغّل الكود تاني.
-- =========================================================

create table if not exists public.app_admins (
  email text primary key
);

insert into public.app_admins (email) values
  ('admin@matco.app')
on conflict (email) do nothing;

alter table public.app_admins enable row level security;

-- كل مستخدم يقدر يعرف هو مدير ولا لأ (بيشوف سطره بس)
drop policy if exists "see own admin row" on public.app_admins;
create policy "see own admin row" on public.app_admins
  for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_admins
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- المدير بس يقدر يضيف ويعدّل الموظفين
drop policy if exists "admin insert employees" on public.employees;
create policy "admin insert employees" on public.employees
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin update employees" on public.employees;
create policy "admin update employees" on public.employees
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
