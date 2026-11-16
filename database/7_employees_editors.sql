-- =========================================================
-- تعديل بيانات الموظفين من تبويب «الموظفون» — يُشغَّل مرة واحدة
-- Supabase ← SQL Editor ← New query ← الصق الكود ← Run
-- (يتطلب تشغيل الملفات 3 و 4 و 5 قبله)
--
-- • المدير يعدّل كل شيء كما كان.
-- • المستخدم الذي يمنحه المدير صلاحية «بيانات الموظفين» من صفحة الإعدادات
--   يستطيع تعديل: القسم، والوظيفة، والجنسية، ودوام السبت فقط.
-- • الرقم الوظيفي، والاسم العربي، والاسم الإنجليزي، ورقم الهوية / الإقامة
--   محميّة في قاعدة البيانات نفسها ولا يغيّرها إلا المدير.
-- =========================================================

-- 1) هل المستخدم الحالي مسموح له بتعديل الموظفين؟
create or replace function public.can_edit_employees()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v  text;
  em text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if public.is_admin() then
    return true;
  end if;
  if em = '' then
    return false;
  end if;
  select value into v from public.app_settings where key = 'employees_users';
  if v is null then
    return false;
  end if;
  begin
    return exists (select 1 from jsonb_array_elements_text(v::jsonb) x where lower(x) = em);
  exception when others then
    return false;
  end;
end;
$$;

revoke all on function public.can_edit_employees() from public, anon;
grant execute on function public.can_edit_employees() to authenticated;

-- 2) السماح لهم بالتعديل (بدون إضافة أو حذف)
drop policy if exists "editors update employees" on public.employees;
create policy "editors update employees" on public.employees
  for update to authenticated
  using (public.can_edit_employees())
  with check (public.can_edit_employees());

-- 3) حماية الحقول المقفلة: لا يغيّرها إلا المدير
create or replace function public.protect_employee_keys()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() and (
       new.employee_id is distinct from old.employee_id
    or new.name_ar     is distinct from old.name_ar
    or new.name_en     is distinct from old.name_en
    or new.national_id is distinct from old.national_id
  ) then
    raise exception 'لا يمكن تعديل الرقم الوظيفي أو الاسم العربي أو الاسم الإنجليزي أو رقم الهوية — هذا متاح للمدير فقط';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_employee_keys on public.employees;
create trigger protect_employee_keys
  before update on public.employees
  for each row execute function public.protect_employee_keys();
