create extension if not exists pgcrypto;

create table if not exists public.tahweeshti_accounts (
  id uuid primary key default gen_random_uuid(),
  pin_lookup text unique,
  pin_salt text not null,
  pin_hash text not null,
  iterations integer not null default 120000,
  admin_pin_salt text,
  admin_pin_hash text,
  admin_iterations integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Preserve the original single-account installation as the first account.
insert into public.tahweeshti_accounts (
  pin_salt,pin_hash,iterations,admin_pin_salt,admin_pin_hash,admin_iterations,created_at,updated_at
)
select s.pin_salt,s.pin_hash,coalesce(s.iterations,120000),s.admin_pin_salt,s.admin_pin_hash,s.admin_iterations,
       coalesce(s.created_at,now()),coalesce(s.updated_at,now())
from public.tahweeshti_settings s
where s.id=1
  and not exists (select 1 from public.tahweeshti_accounts);

alter table public.tahweeshti_sessions add column if not exists account_id uuid;
alter table public.tahweeshti_shared_entries add column if not exists account_id uuid;
alter table public.tahweeshti_shared_payments add column if not exists account_id uuid;
alter table public.tahweeshti_documents add column if not exists account_id uuid;
alter table public.tahweeshti_audit add column if not exists account_id uuid;

-- Attach all pre-multi-account data to the original account.
update public.tahweeshti_sessions
set account_id=(select id from public.tahweeshti_accounts order by created_at asc limit 1)
where account_id is null and exists(select 1 from public.tahweeshti_accounts);
update public.tahweeshti_shared_entries
set account_id=(select id from public.tahweeshti_accounts order by created_at asc limit 1)
where account_id is null and exists(select 1 from public.tahweeshti_accounts);
update public.tahweeshti_shared_payments
set account_id=(select id from public.tahweeshti_accounts order by created_at asc limit 1)
where account_id is null and exists(select 1 from public.tahweeshti_accounts);
update public.tahweeshti_documents
set account_id=(select id from public.tahweeshti_accounts order by created_at asc limit 1)
where account_id is null and exists(select 1 from public.tahweeshti_accounts);
update public.tahweeshti_audit
set account_id=(select id from public.tahweeshti_accounts order by created_at asc limit 1)
where account_id is null and exists(select 1 from public.tahweeshti_accounts);

create index if not exists idx_tah_sessions_account on public.tahweeshti_sessions(account_id);
create index if not exists idx_tah_entries_account_date on public.tahweeshti_shared_entries(account_id,entry_date desc);
create index if not exists idx_tah_payments_account_date on public.tahweeshti_shared_payments(account_id,payment_date desc);
create index if not exists idx_tah_documents_account_kind on public.tahweeshti_documents(account_id,kind);
create index if not exists idx_tah_audit_account_created on public.tahweeshti_audit(account_id,created_at desc);

-- Add FKs only once. Keep columns nullable for backwards migration safety; the API always writes account_id.
do $$ begin
  if not exists (select 1 from pg_constraint where conname='tahweeshti_sessions_account_fk') then
    alter table public.tahweeshti_sessions add constraint tahweeshti_sessions_account_fk foreign key(account_id) references public.tahweeshti_accounts(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='tahweeshti_entries_account_fk') then
    alter table public.tahweeshti_shared_entries add constraint tahweeshti_entries_account_fk foreign key(account_id) references public.tahweeshti_accounts(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='tahweeshti_payments_account_fk') then
    alter table public.tahweeshti_shared_payments add constraint tahweeshti_payments_account_fk foreign key(account_id) references public.tahweeshti_accounts(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='tahweeshti_documents_account_fk') then
    alter table public.tahweeshti_documents add constraint tahweeshti_documents_account_fk foreign key(account_id) references public.tahweeshti_accounts(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='tahweeshti_audit_account_fk') then
    alter table public.tahweeshti_audit add constraint tahweeshti_audit_account_fk foreign key(account_id) references public.tahweeshti_accounts(id) on delete cascade;
  end if;
end $$;

create or replace function public.tahweeshti_validate_payment()
returns trigger language plpgsql as $$
declare remaining numeric;
begin
  select e.amount - coalesce((select sum(p.amount) from public.tahweeshti_shared_payments p
                               where p.entry_id=e.id and p.account_id=new.account_id and p.deleted_at is null),0)
    into remaining
    from public.tahweeshti_shared_entries e
    where e.id=new.entry_id and e.account_id=new.account_id and e.deleted_at is null;
  if remaining is null then raise exception 'entry not found'; end if;
  if new.amount > remaining then raise exception 'payment exceeds remaining amount'; end if;
  return new;
end $$;

alter table public.tahweeshti_accounts enable row level security;
-- No public policy: account and financial data are reachable only through the Edge Function service role.
