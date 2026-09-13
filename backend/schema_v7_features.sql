-- Tahweeshti V7 feature expansion
create extension if not exists pgcrypto;

alter table if exists public.tahweeshti_settings
  add column if not exists admin_pin_salt text,
  add column if not exists admin_pin_hash text,
  add column if not exists admin_iterations integer,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.tahweeshti_sessions
  add column if not exists admin_unlocked_until timestamptz;

alter table if exists public.tahweeshti_shared_entries
  add column if not exists meta jsonb not null default '{}'::jsonb,
  add column if not exists deleted_at timestamptz;

alter table if exists public.tahweeshti_shared_payments
  add column if not exists meta jsonb not null default '{}'::jsonb,
  add column if not exists deleted_at timestamptz;

create table if not exists public.tahweeshti_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists tahweeshti_documents_kind_idx on public.tahweeshti_documents(kind);
create index if not exists tahweeshti_documents_deleted_idx on public.tahweeshti_documents(deleted_at);

create table if not exists public.tahweeshti_audit (
  id bigint generated always as identity primary key,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists tahweeshti_audit_created_idx on public.tahweeshti_audit(created_at desc);

alter table public.tahweeshti_documents enable row level security;
alter table public.tahweeshti_audit enable row level security;

-- All browser access remains blocked. The Edge Function uses service_role.

-- Ignore deleted payments when validating a new payment.
create or replace function public.tahweeshti_validate_payment()
returns trigger language plpgsql as $$
declare remaining numeric;
begin
  select e.amount - coalesce((
    select sum(p.amount)
    from public.tahweeshti_shared_payments p
    where p.entry_id=e.id and p.deleted_at is null
  ),0)
  into remaining
  from public.tahweeshti_shared_entries e
  where e.id=new.entry_id and e.deleted_at is null;

  if remaining is null then raise exception 'entry not found'; end if;
  if new.amount > remaining + 0.0001 then raise exception 'payment exceeds remaining amount'; end if;
  return new;
end $$;

drop trigger if exists tahweeshti_payment_guard on public.tahweeshti_shared_payments;
create trigger tahweeshti_payment_guard before insert on public.tahweeshti_shared_payments
for each row execute function public.tahweeshti_validate_payment();
