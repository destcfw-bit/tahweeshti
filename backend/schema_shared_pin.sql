create extension if not exists pgcrypto;

create table if not exists public.tahweeshti_settings (
  id integer primary key check (id = 1),
  pin_salt text not null,
  pin_hash text not null,
  iterations integer not null default 120000,
  created_at timestamptz not null default now()
);

create table if not exists public.tahweeshti_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.tahweeshti_login_attempts (
  client_key text primary key,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz
);

create table if not exists public.tahweeshti_shared_entries (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('receivable','payable','income','expense')),
  person text not null default '',
  amount numeric(14,3) not null check (amount > 0),
  entry_date date not null,
  note text not null default '',
  receipt_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tahweeshti_shared_payments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.tahweeshti_shared_entries(id) on delete cascade,
  amount numeric(14,3) not null check (amount > 0),
  payment_date date not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.tahweeshti_validate_payment()
returns trigger language plpgsql as $$
declare remaining numeric;
begin
  select e.amount - coalesce((select sum(p.amount) from public.tahweeshti_shared_payments p where p.entry_id=e.id),0)
    into remaining from public.tahweeshti_shared_entries e where e.id=new.entry_id;
  if remaining is null then raise exception 'entry not found'; end if;
  if new.amount > remaining then raise exception 'payment exceeds remaining amount'; end if;
  return new;
end $$;

drop trigger if exists tahweeshti_payment_guard on public.tahweeshti_shared_payments;
create trigger tahweeshti_payment_guard before insert on public.tahweeshti_shared_payments
for each row execute function public.tahweeshti_validate_payment();

alter table public.tahweeshti_settings enable row level security;
alter table public.tahweeshti_sessions enable row level security;
alter table public.tahweeshti_login_attempts enable row level security;
alter table public.tahweeshti_shared_entries enable row level security;
alter table public.tahweeshti_shared_payments enable row level security;

-- No public RLS policies on purpose: browser talks only to the Edge Function.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('receipts','receipts',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
