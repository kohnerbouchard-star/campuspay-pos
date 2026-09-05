-- CampusPay foundation for Neon or standard PostgreSQL.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
create schema if not exists api;

revoke all on schema private from public;
revoke all on schema api from public;
revoke create on schema public from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'campuspay_runtime') then
    create role campuspay_runtime nologin noinherit;
  end if;
end;
$$;

do $$ begin execute format('grant campuspay_runtime to %I', current_user); end; $$;
grant usage on schema api to campuspay_runtime;

create type public.staff_role as enum ('cashier', 'inventory_admin', 'accountant', 'super_admin');
create type public.cost_method as enum ('FIFO', 'LIFO');
create type private.intent_state as enum ('awaiting_card', 'awaiting_pin', 'completed', 'cancelled', 'expired');
create type private.wallet_direction as enum ('CREDIT', 'DEBIT');
create type private.inventory_movement_type as enum (
  'PURCHASE_RECEIPT', 'SALE', 'SALE_REVERSAL', 'DAMAGED', 'EXPIRED', 'SUPPLIER_RETURN', 'STOCK_COUNT_LOSS'
);

create sequence if not exists private.sale_receipt_sequence;
create sequence if not exists private.stock_receipt_sequence;
create sequence if not exists private.adjustment_sequence;

create table public.staff_profiles (
  auth_user_id uuid primary key default gen_random_uuid(),
  employee_code text not null unique check (employee_code ~ '^[A-Za-z0-9_-]{2,32}$'),
  display_name text not null check (length(display_name) between 1 and 120),
  role public.staff_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.staff_credentials (
  staff_user_id uuid primary key references public.staff_profiles(auth_user_id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  pin_updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (length(sku) between 1 and 40),
  name text not null check (length(name) between 1 and 120),
  category text not null check (length(category) between 1 and 80),
  selling_price_won bigint not null check (selling_price_won >= 0),
  reorder_level integer not null default 0 check (reorder_level >= 0),
  active boolean not null default true,
  created_by uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.system_settings (
  singleton boolean primary key default true check (singleton),
  negative_wallet_limit_won bigint not null default -15000 check (negative_wallet_limit_won <= 0),
  inventory_cost_method public.cost_method not null default 'FIFO',
  updated_by uuid references public.staff_profiles(auth_user_id) on delete restrict,
  updated_at timestamptz not null default now()
);
insert into private.system_settings(singleton) values (true) on conflict (singleton) do nothing;

create table private.terminals (
  id uuid primary key default gen_random_uuid(),
  terminal_fingerprint text not null unique check (length(terminal_fingerprint) = 64),
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table private.staff_sessions (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references public.staff_profiles(auth_user_id) on delete cascade,
  employee_code_snapshot text not null,
  role_snapshot public.staff_role not null,
  terminal_id uuid not null references private.terminals(id) on delete restrict,
  session_token_hash text not null unique check (length(session_token_hash) = 64),
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index staff_sessions_active_idx on private.staff_sessions(auth_user_id, expires_at) where revoked_at is null;

create table private.students (
  id uuid primary key default gen_random_uuid(),
  student_code text not null unique,
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.student_credentials (
  student_id uuid primary key references private.students(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  pin_updated_at timestamptz not null default now()
);

create table private.student_cards (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references private.students(id) on delete cascade,
  card_fingerprint text not null unique check (length(card_fingerprint) = 64),
  active boolean not null default true,
  issued_by uuid references public.staff_profiles(auth_user_id) on delete restrict,
  issued_at timestamptz not null default now(),
  deactivated_at timestamptz
);
create unique index one_active_card_per_student on private.student_cards(student_id) where active;

create table private.wallets (
  student_id uuid primary key references private.students(id) on delete restrict,
  balance_won bigint not null default 0 check (balance_won >= -15000),
  updated_at timestamptz not null default now()
);

create table private.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  reference_number text not null unique,
  student_id uuid not null references private.students(id) on delete restrict,
  amount_won bigint not null check (amount_won <> 0),
  entry_type text not null,
  reason_code text not null,
  balance_before_won bigint not null,
  balance_after_won bigint not null,
  staff_user_id uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
  staff_session_id uuid not null references private.staff_sessions(id) on delete restrict,
  source_type text not null,
  source_id uuid,
  idempotency_key uuid not null unique,
  notes text,
  created_at timestamptz not null default now()
);
create index wallet_ledger_student_created_idx on private.wallet_ledger(student_id, created_at desc);

create table private.product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  old_price_won bigint not null,
  new_price_won bigint not null,
  reason text not null,
  changed_by uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
  staff_session_id uuid not null references private.staff_sessions(id) on delete restrict,
  changed_at timestamptz not null default now()
);

create table private.stock_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  supplier_name text not null,
  supplier_invoice text not null,
  purchase_date date not null,
  purchase_subtotal_won bigint not null check (purchase_subtotal_won >= 0),
  shipping_won bigint not null check (shipping_won >= 0),
  other_costs_won bigint not null check (other_costs_won >= 0),
  discount_won bigint not null check (discount_won >= 0),
  total_landed_cost_won bigint not null check (total_landed_cost_won >= 0),
  notes text,
  received_by uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
  staff_session_id uuid not null references private.staff_sessions(id) on delete restrict,
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  unique(supplier_name, supplier_invoice)
);

create table private.stock_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references private.stock_receipts(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  purchase_unit_cost_won bigint not null check (purchase_unit_cost_won >= 0),
  base_cost_won bigint not null check (base_cost_won >= 0),
  allocated_overhead_won bigint not null check (allocated_overhead_won >= 0),
  allocated_discount_won bigint not null check (allocated_discount_won >= 0),
  total_landed_cost_won bigint not null check (total_landed_cost_won >= 0),
  supplier_lot_code text,
  expiration_date date,
  created_at timestamptz not null default now()
);

create table private.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  receipt_line_id uuid not null unique references private.stock_receipt_lines(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  received_at timestamptz not null default now(),
  expiration_date date,
  quantity_received integer not null check (quantity_received > 0),
  quantity_remaining integer not null check (quantity_remaining between 0 and quantity_received),
  landed_unit_cost_won numeric(18,6) not null check (landed_unit_cost_won >= 0),
  created_at timestamptz not null default now()
);
create index inventory_lots_allocation_idx on private.inventory_lots(product_id, received_at, id) where quantity_remaining > 0;

create table private.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  lot_id uuid not null references private.inventory_lots(id) on delete restrict,
  movement_type private.inventory_movement_type not null,
  quantity_change integer not null check (quantity_change <> 0),
  unit_cost_won numeric(18,6) not null check (unit_cost_won >= 0),
  total_cost_won bigint not null,
  reason_code text not null,
  notes text,
  staff_user_id uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
  staff_session_id uuid not null references private.staff_sessions(id) on delete restrict,
  source_type text not null,
  source_id uuid,
  idempotency_key uuid,
  created_at timestamptz not null default now()
);
create index inventory_movements_product_created_idx on private.inventory_movements(product_id, created_at desc);

create table private.payment_intents (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  staff_session_id uuid not null references private.staff_sessions(id) on delete restrict,
  student_id uuid references private.students(id) on delete restrict,
  state private.intent_state not null default 'awaiting_card',
  total_won bigint not null check (total_won > 0),
  pin_attempts integer not null default 0 check (pin_attempts between 0 and 3),
  card_scanned_at timestamptz,
  completed_sale_id uuid,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.payment_intent_items (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references private.payment_intents(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price_won bigint not null check (unit_price_won >= 0),
  line_total_won bigint not null check (line_total_won >= 0),
  unique(intent_id, product_id)
);

create table private.sales (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  student_id uuid not null references private.students(id) on delete restrict,
  cashier_user_id uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
  staff_session_id uuid not null references private.staff_sessions(id) on delete restrict,
  total_won bigint not null check (total_won > 0),
  cost_of_goods_sold_won bigint not null default 0 check (cost_of_goods_sold_won >= 0),
  wallet_ledger_id uuid,
  payment_intent_id uuid not null unique references private.payment_intents(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table private.payment_intents
  add constraint payment_intents_completed_sale_fk
  foreign key (completed_sale_id) references private.sales(id) on delete restrict;

create table private.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references private.sales(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name_snapshot text not null,
  quantity integer not null check (quantity > 0),
  unit_price_won bigint not null check (unit_price_won >= 0),
  line_total_won bigint not null check (line_total_won >= 0),
  cogs_won bigint not null default 0 check (cogs_won >= 0)
);

create table private.sale_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  sale_item_id uuid not null references private.sale_items(id) on delete restrict,
  inventory_lot_id uuid not null references private.inventory_lots(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_cost_won numeric(18,6) not null check (unit_cost_won >= 0),
  total_cost_won bigint not null check (total_cost_won >= 0),
  created_at timestamptz not null default now()
);

create table private.wallet_adjustment_intents (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  staff_session_id uuid not null references private.staff_sessions(id) on delete restrict,
  student_id uuid references private.students(id) on delete restrict,
  direction private.wallet_direction not null,
  amount_won bigint not null check (amount_won > 0),
  denominations integer[] not null,
  reason_code text not null,
  notes text not null,
  state private.intent_state not null default 'awaiting_card',
  pin_attempts integer not null default 0 check (pin_attempts between 0 and 3),
  completed_ledger_id uuid references private.wallet_ledger(id) on delete restrict,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.elevation_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (length(token_hash) = 64),
  requested_by uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
  approved_by uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
  staff_session_id uuid not null references private.staff_sessions(id) on delete restrict,
  purpose text not null check (purpose in ('RESET_STUDENT_PIN', 'RESET_STUDENT_CARD')),
  student_id uuid not null references private.students(id) on delete restrict,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table private.audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_user_id uuid references public.staff_profiles(auth_user_id) on delete restrict,
  approver_user_id uuid references public.staff_profiles(auth_user_id) on delete restrict,
  staff_session_id uuid references private.staff_sessions(id) on delete restrict,
  subject_type text,
  subject_id uuid,
  reference_number text not null unique,
  safe_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The runtime role receives no direct table or sequence access.
revoke all on all tables in schema private from public, campuspay_runtime;
revoke all on all sequences in schema private from public, campuspay_runtime;
revoke all on public.staff_profiles, public.products from public, campuspay_runtime;
