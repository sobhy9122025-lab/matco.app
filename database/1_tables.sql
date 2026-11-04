-- =========================================================
-- تجهيز قاعدة بيانات نظام الحضور والإجازات (يتشغّل مرة واحدة)
-- Supabase ← SQL Editor ← New query ← الصق الكود ← Run
-- =========================================================

-- الموظفين
create table if not exists public.employees (
  employee_id            text primary key,
  name_ar                text,
  name_en                text,
  department             text,
  job_title              text,
  nationality            text,
  attendance_calculation text
);

-- الإجازات
create table if not exists public.leaves (
  leave_id        text primary key,
  employee_id     text not null,
  employee_no     text,
  name_ar         text,
  name_en         text,
  department      text,
  job_title       text,
  leave_type      text,
  start_date      date,
  end_date        date,
  status          text default 'معتمدة',
  attachment_name text,
  attachment_path text,
  notes           text,
  created_at      timestamptz default now(),
  created_by      text
);
create index if not exists leaves_employee_idx on public.leaves (employee_id);
create index if not exists leaves_dates_idx    on public.leaves (start_date, end_date);

-- الغياب والتأخير
create table if not exists public.absences (
  record_id       text primary key,
  employee_id     text not null,
  employee_no     text,
  name_ar         text,
  department      text,
  record_type     text,
  start_date      date,
  end_date        date,
  reason          text,
  attachment_name text,
  attachment_path text,
  created_at      timestamptz default now(),
  created_by      text
);
create index if not exists absences_employee_idx on public.absences (employee_id);

-- حماية: محدش يقدر يقرا أو يكتب في الجداول غير الموقع (بالمفتاح السري)
alter table public.employees enable row level security;
alter table public.leaves    enable row level security;
alter table public.absences  enable row level security;

-- مخزن المرفقات (خاص — مش متاح للعامة)
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;
