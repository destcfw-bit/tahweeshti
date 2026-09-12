-- تحويشتي — Supabase schema
-- المشروع الحالي مجهز بالفعل. هذا الملف لإعادة إنشاء القاعدة في مشروع Supabase آخر عند الحاجة.

create extension if not exists pgcrypto;

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('receivable','payable','income','expense')),
  person text not null default '',
  amount numeric(14,3) not null check (amount > 0),
  entry_date date not null default current_date,
  note text not null default '',
  receipt_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_id uuid not null references public.entries(id) on delete cascade,
  amount numeric(14,3) not null check (amount > 0),
  payment_date date not null default current_date,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists entries_user_date_idx on public.entries(user_id, entry_date desc, created_at desc);
create index if not exists payments_user_entry_idx on public.payments(user_id, entry_id);
create index if not exists payments_entry_idx on public.payments(entry_id);

create or replace function public.tahweeshti_validate_payment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  e_amount numeric(14,3);
  e_type text;
  e_user uuid;
  already_paid numeric(14,3);
begin
  select amount, type, user_id into e_amount, e_type, e_user
  from public.entries where id = new.entry_id;

  if e_user is null or e_user <> new.user_id then
    raise exception 'Invalid entry owner';
  end if;

  if e_type not in ('receivable','payable') then
    raise exception 'Payments are only allowed for debts';
  end if;

  select coalesce(sum(amount),0) into already_paid
  from public.payments
  where entry_id = new.entry_id and id <> new.id;

  if already_paid + new.amount > e_amount then
    raise exception 'Payment exceeds remaining amount';
  end if;

  return new;
end;
$$;

drop trigger if exists tahweeshti_payments_validate on public.payments;
create trigger tahweeshti_payments_validate
before insert or update on public.payments
for each row execute function public.tahweeshti_validate_payment();

create or replace function public.tahweeshti_validate_entry_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  paid_total numeric(14,3);
begin
  select coalesce(sum(amount),0) into paid_total
  from public.payments where entry_id = old.id;

  if paid_total > 0 and new.type not in ('receivable','payable') then
    raise exception 'A debt with payments cannot be changed to income or expense';
  end if;

  if paid_total > new.amount then
    raise exception 'Entry amount cannot be lower than payments already recorded';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tahweeshti_entries_validate_update on public.entries;
create trigger tahweeshti_entries_validate_update
before update on public.entries
for each row execute function public.tahweeshti_validate_entry_update();

alter table public.entries enable row level security;
alter table public.payments enable row level security;

revoke all on table public.entries from anon;
revoke all on table public.payments from anon;
grant select, insert, update, delete on table public.entries to authenticated;
grant select, insert, update, delete on table public.payments to authenticated;

drop policy if exists tahweeshti_entries_select_own on public.entries;
drop policy if exists tahweeshti_entries_insert_own on public.entries;
drop policy if exists tahweeshti_entries_update_own on public.entries;
drop policy if exists tahweeshti_entries_delete_own on public.entries;
create policy tahweeshti_entries_select_own on public.entries for select to authenticated using ((select auth.uid()) = user_id);
create policy tahweeshti_entries_insert_own on public.entries for insert to authenticated with check ((select auth.uid()) = user_id);
create policy tahweeshti_entries_update_own on public.entries for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy tahweeshti_entries_delete_own on public.entries for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists tahweeshti_payments_select_own on public.payments;
drop policy if exists tahweeshti_payments_insert_own on public.payments;
drop policy if exists tahweeshti_payments_update_own on public.payments;
drop policy if exists tahweeshti_payments_delete_own on public.payments;
create policy tahweeshti_payments_select_own on public.payments for select to authenticated using ((select auth.uid()) = user_id);
create policy tahweeshti_payments_insert_own on public.payments for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.entries e where e.id = entry_id and e.user_id = (select auth.uid())));
create policy tahweeshti_payments_update_own on public.payments for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy tahweeshti_payments_delete_own on public.payments for delete to authenticated using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts','receipts',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists tahweeshti_receipts_select_own on storage.objects;
drop policy if exists tahweeshti_receipts_insert_own on storage.objects;
drop policy if exists tahweeshti_receipts_update_own on storage.objects;
drop policy if exists tahweeshti_receipts_delete_own on storage.objects;
create policy tahweeshti_receipts_select_own on storage.objects for select to authenticated using (bucket_id='receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy tahweeshti_receipts_insert_own on storage.objects for insert to authenticated with check (bucket_id='receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy tahweeshti_receipts_update_own on storage.objects for update to authenticated using (bucket_id='receipts' and (storage.foldername(name))[1] = (select auth.uid())::text) with check (bucket_id='receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy tahweeshti_receipts_delete_own on storage.objects for delete to authenticated using (bucket_id='receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
