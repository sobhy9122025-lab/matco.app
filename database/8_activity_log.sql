-- =========================================================
-- سجل النشاط (للمدير) — يُشغَّل مرة واحدة
-- Supabase ← SQL Editor ← New query ← الصق الكود ← Run
-- (يتطلب تشغيل الملفات 3 و 4 و 5 قبله)
--
-- • كل إضافة أو تعديل أو حذف في الإجازات والغياب والموظفين والإعدادات
--   يُسجَّل تلقائيًا داخل قاعدة البيانات (لا يمكن تجاوزه من البرنامج).
-- • البرنامج يسجّل أيضًا: الدخول والخروج، فتح الصفحات، رفع الملفات، الطباعة والتصدير.
-- • السجل للقراءة فقط: لا يستطيع أحد تعديله أو حذفه من البرنامج، والمدير وحده يقرؤه.
-- =========================================================

-- 1) جدول السجل
create table if not exists public.activity_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  user_email  text,
  action      text not null,      -- insert / update / delete / login / logout / view / upload / print / export / ...
  entity      text,               -- leave / absence / employee / setting / page / user / ...
  record_id   text,
  details     jsonb default '{}'::jsonb
);
create index if not exists activity_log_at_idx    on public.activity_log (at desc);
create index if not exists activity_log_user_idx  on public.activity_log (user_email, at desc);

-- 2) آخر ظهور لكل مستخدم (لمعرفة من يستخدم البرنامج الآن)
create table if not exists public.user_presence (
  email       text primary key,
  last_seen   timestamptz not null default now(),
  page        text,
  since       timestamptz default now()
);

alter table public.activity_log  enable row level security;
alter table public.user_presence enable row level security;

drop policy if exists "admin read activity" on public.activity_log;
create policy "admin read activity" on public.activity_log
  for select to authenticated using (public.is_admin());

drop policy if exists "admin read presence" on public.user_presence;
create policy "admin read presence" on public.user_presence
  for select to authenticated using (public.is_admin());

-- القراءة مسموحة (والسياسات أعلاه تجعلها للمدير فقط)
grant select on public.activity_log, public.user_presence to authenticated;
-- لا توجد صلاحية إضافة أو تعديل أو حذف مباشرة: الكتابة تتم فقط عبر الدوال أدناه
revoke insert, update, delete on public.activity_log  from anon, authenticated;
revoke insert, update, delete on public.user_presence from anon, authenticated;

-- 3) تسجيل تلقائي لأي تغيير في البيانات
create or replace function public.log_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  em       text := coalesce(auth.jwt() ->> 'email', 'system');
  o        jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n        jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r        jsonb := coalesce(n, o);
  ent      text;
  rid      text;
  changes  jsonb := '{}'::jsonb;
  k        text;
  skip     text[] := array['created_at', 'created_by', 'updated_at', 'updated_by', 'employee_no'];
  snap     jsonb;
begin
  ent := case tg_table_name when 'leaves' then 'leave' when 'absences' then 'absence'
                            when 'employees' then 'employee' when 'app_settings' then 'setting' else tg_table_name end;
  rid := coalesce(r ->> 'leave_id', r ->> 'record_id', case when tg_table_name = 'app_settings' then r ->> 'key' end, r ->> 'employee_id');

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if not (k = any (skip)) and (o -> k) is distinct from (n -> k) then
        changes := changes || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      end if;
    end loop;
    if changes = '{}'::jsonb then
      return null;           -- تعديل بلا تغيير فعلي (مثل إعادة رفع نفس الملف) لا يُسجَّل
    end if;
  end if;

  -- ملخص السطر لعرضه في السجل (بدون رقم الهوية)
  snap := jsonb_strip_nulls(jsonb_build_object(
    'employee_id', r ->> 'employee_id', 'name_ar', r ->> 'name_ar',
    'type', coalesce(r ->> 'leave_type', r ->> 'record_type'), 'status', r ->> 'status',
    'start_date', r ->> 'start_date', 'end_date', r ->> 'end_date',
    'department', r ->> 'department', 'value', case when tg_table_name = 'app_settings' then r ->> 'value' end));

  insert into public.activity_log (user_email, action, entity, record_id, details)
  values (em, lower(tg_op), ent, rid, jsonb_build_object('row', snap, 'changes', changes));
  return null;
end;
$$;

drop trigger if exists log_changes on public.leaves;
create trigger log_changes after insert or update or delete on public.leaves
  for each row execute function public.log_row_change();
drop trigger if exists log_changes on public.absences;
create trigger log_changes after insert or update or delete on public.absences
  for each row execute function public.log_row_change();
drop trigger if exists log_changes on public.employees;
create trigger log_changes after insert or update or delete on public.employees
  for each row execute function public.log_row_change();
drop trigger if exists log_changes on public.app_settings;
create trigger log_changes after insert or update or delete on public.app_settings
  for each row execute function public.log_row_change();

-- 4) تسجيل الأحداث من البرنامج (الدخول، فتح الصفحات، الرفع، الطباعة، التصدير …)
create or replace function public.log_activity(p_action text, p_entity text default null, p_details jsonb default '{}'::jsonb, p_page text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  em text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if em = '' then
    return;
  end if;
  insert into public.activity_log (user_email, action, entity, details)
  values (em, left(coalesce(p_action, 'event'), 40), left(p_entity, 40), coalesce(p_details, '{}'::jsonb));
  insert into public.user_presence (email, last_seen, page, since)
  values (em, now(), p_page, now())
  on conflict (email) do update
    set last_seen = now(),
        page = coalesce(excluded.page, user_presence.page),
        since = case when p_action = 'login' or user_presence.last_seen < now() - interval '30 minutes' then now() else user_presence.since end;
  -- تنظيف تلقائي: حذف ما مضى عليه أكثر من سنة (أحيانًا فقط)
  if random() < 0.01 then
    delete from public.activity_log where at < now() - interval '365 days';
  end if;
end;
$$;

-- 5) نبضة «متصل الآن» كل دقيقتين أثناء فتح البرنامج
create or replace function public.touch_presence(p_page text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  em text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if em = '' then
    return;
  end if;
  insert into public.user_presence (email, last_seen, page, since)
  values (em, now(), p_page, now())
  on conflict (email) do update
    set last_seen = now(),
        page = coalesce(excluded.page, user_presence.page),
        since = case when user_presence.last_seen < now() - interval '30 minutes' then now() else user_presence.since end;
end;
$$;

revoke all on function public.log_activity(text, text, jsonb, text) from public, anon;
revoke all on function public.touch_presence(text) from public, anon;
grant execute on function public.log_activity(text, text, jsonb, text) to authenticated;
grant execute on function public.touch_presence(text) to authenticated;
