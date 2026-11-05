-- =========================================================
-- إضافة رقم الهوية / الإقامة للموظفين — يُشغَّل مرة واحدة
-- Supabase ← SQL Editor ← New query ← الصق الكود ← Run
-- يُستخدم للبحث عن الموظف برقم الهوية (مثل التقارير الطبية)
-- البيانات محمية: لا يقرؤها إلا المستخدم المسجّل دخوله، ولا يعدّلها إلا المدير
-- =========================================================
alter table public.employees add column if not exists national_id text;
create index if not exists employees_national_id_idx on public.employees (national_id);
