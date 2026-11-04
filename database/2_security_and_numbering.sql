-- =========================================================
-- تجهيز قاعدة البيانات للموقع الجديد (HTML)  — يتشغّل مرة واحدة
-- Supabase ← SQL Editor ← New query ← الصق الكود ← Run
--
-- بيعمل 3 حاجات:
--   1) الترقيم التلقائي  LV-1, LV-2 ... / AB-1, AB-2 ...  (من غير تكرار حتى لو اتنين سجّلوا في نفس اللحظة)
--   2) تعبئة الاسم والقسم والوظيفة تلقائيًا من جدول الموظفين بمجرد كتابة الرقم الوظيفي
--   3) الحماية: محدش يقدر يقرا أو يكتب غير المستخدم اللي سجّل دخول
-- الموقع القديم (Streamlit) هيفضل شغال عادي، لأنه بيستخدم المفتاح السري.
-- =========================================================

-- ---------- 1) الترقيم التلقائي ----------
create or replace function public.assign_record_id()
returns trigger
language plpgsql
as $$
declare
  n integer;
begin
  -- قفل مؤقت عشان رقمين ما يطلعوش نفس الرقم
  perform pg_advisory_xact_lock(hashtext('seq_' || tg_table_name));

  if tg_table_name = 'leaves' then
    if new.leave_id is null or btrim(new.leave_id) = '' then
      select coalesce(max((regexp_match(leave_id, '^LV-(\d+)$'))[1]::int), 0) + 1
        into n from public.leaves;
      new.leave_id := 'LV-' || n;
    end if;
  elsif tg_table_name = 'absences' then
    if new.record_id is null or btrim(new.record_id) = '' then
      select coalesce(max((regexp_match(record_id, '^AB-(\d+)$'))[1]::int), 0) + 1
        into n from public.absences;
      new.record_id := 'AB-' || n;
    end if;
  end if;

  if new.created_at is null then
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists leaves_assign_id on public.leaves;
create trigger leaves_assign_id before insert on public.leaves
  for each row execute function public.assign_record_id();

drop trigger if exists absences_assign_id on public.absences;
create trigger absences_assign_id before insert on public.absences
  for each row execute function public.assign_record_id();

-- ---------- 2) تعبئة بيانات الموظف تلقائيًا ----------
create or replace function public.fill_employee_fields()
returns trigger
language plpgsql
as $$
declare
  e public.employees%rowtype;
begin
  new.employee_id := btrim(new.employee_id);
  select * into e from public.employees where employee_id = new.employee_id;
  if not found then
    raise exception 'الرقم الوظيفي % غير موجود في جدول الموظفين', new.employee_id;
  end if;

  new.employee_no := new.employee_id;
  new.name_ar     := e.name_ar;
  new.department  := e.department;
  if tg_table_name = 'leaves' then
    new.name_en   := e.name_en;
    new.job_title := e.job_title;
  end if;
  return new;
end;
$$;

drop trigger if exists leaves_fill_employee on public.leaves;
create trigger leaves_fill_employee before insert or update of employee_id on public.leaves
  for each row execute function public.fill_employee_fields();

drop trigger if exists absences_fill_employee on public.absences;
create trigger absences_fill_employee before insert or update of employee_id on public.absences
  for each row execute function public.fill_employee_fields();

-- ---------- 3) الحماية (للمستخدمين المسجلين بس) ----------
alter table public.employees enable row level security;
alter table public.leaves    enable row level security;
alter table public.absences  enable row level security;

drop policy if exists "signed in read employees" on public.employees;
create policy "signed in read employees" on public.employees
  for select to authenticated using (true);

drop policy if exists "signed in manage leaves" on public.leaves;
create policy "signed in manage leaves" on public.leaves
  for all to authenticated using (true) with check (true);

drop policy if exists "signed in manage absences" on public.absences;
create policy "signed in manage absences" on public.absences
  for all to authenticated using (true) with check (true);

-- المرفقات
drop policy if exists "signed in read attachments" on storage.objects;
create policy "signed in read attachments" on storage.objects
  for select to authenticated using (bucket_id = 'attachments');

drop policy if exists "signed in upload attachments" on storage.objects;
create policy "signed in upload attachments" on storage.objects
  for insert to authenticated with check (bucket_id = 'attachments');

drop policy if exists "signed in replace attachments" on storage.objects;
create policy "signed in replace attachments" on storage.objects
  for update to authenticated using (bucket_id = 'attachments');
