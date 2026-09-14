-- Reviewed from the local schema diff. Keep explicit revocations: target
-- database default privileges must not expose SECURITY DEFINER functions.
-- Commit webhook effects and their receipt together. Existing ledger rows are
-- version 0: their writes may have failed after the receipt was inserted, so
-- allow one transactional replay to repair them.
alter table public.stripe_events add column protocol_version integer not null default 0;

create table public.billing_checkout_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  deleting boolean not null default false,
  attempt jsonb,
  updated_at timestamptz not null default now()
);
alter table public.billing_checkout_state enable row level security;
revoke all on public.billing_checkout_state from public, anon, authenticated;
grant all on public.billing_checkout_state to service_role;
grant select, insert, update on public.stripe_events to service_role;
grant select, insert, update on public.billing_subscriptions to service_role;
grant select, insert, update on public.account_entitlements to service_role;

create function public.billing_link_customer(p_owner uuid, p_customer text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text, 0));
  if not exists (select 1 from auth.users where id = p_owner) then raise exception 'Account unavailable'; end if;
  if exists (select 1 from public.billing_checkout_state where owner_id = p_owner and deleting) then
    raise exception 'Account deletion in progress';
  end if;
  select stripe_customer_id into existing from public.billing_subscriptions where owner_id = p_owner;
  if existing is not null and existing <> p_customer then raise exception 'Customer already linked'; end if;
  insert into public.billing_subscriptions(owner_id, stripe_customer_id) values (p_owner, p_customer)
    on conflict (owner_id) do nothing;
  -- Customer association must never advance the subscription event clock.
  return '{}'::jsonb;
end $$;

create function public.billing_apply_event(p_event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := (p_event->>'ownerId')::uuid;
  mode text := p_event->>'mode';
  row_data jsonb := p_event->'row';
  grant_data jsonb := p_event->'grant';
  existing public.billing_subscriptions%rowtype;
  version integer;
begin
  if owner is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner::text, 0));
  end if;
  insert into public.stripe_events(id, event_type, protocol_version)
    values (p_event->>'eventId', p_event->>'eventType', 0) on conflict (id) do nothing;
  select protocol_version into version from public.stripe_events where id = p_event->>'eventId' for update;
  if version = 1 then return jsonb_build_object('outcome', 'replay'); end if;
  update public.stripe_events set protocol_version = 1 where id = p_event->>'eventId';
  if mode in ('ignored', 'noted') then return jsonb_build_object('outcome', mode); end if;
  if owner is null or not exists (select 1 from auth.users where id = owner) then
    return jsonb_build_object('outcome', 'orphan');
  end if;
  select * into existing from public.billing_subscriptions where owner_id = owner for update;
  if mode = 'link' then
    if existing.stripe_customer_id is not null and existing.stripe_customer_id <> p_event->>'customerId' then
      raise exception 'Customer mismatch';
    end if;
    insert into public.billing_subscriptions(owner_id, stripe_customer_id)
      values (owner, p_event->>'customerId') on conflict (owner_id) do nothing;
    return jsonb_build_object('outcome', 'linked');
  end if;
  if mode <> 'subscription' or row_data is null or grant_data is null then raise exception 'Invalid event'; end if;
  if existing.last_event_created > (row_data->>'last_event_created')::timestamptz then
    return jsonb_build_object('outcome', 'stale');
  end if;
  -- A cancellation of an older subscription must not revoke a newer one.
  if existing.stripe_subscription_id is not null and existing.stripe_subscription_id <> row_data->>'stripe_subscription_id'
      and row_data->>'status' in ('canceled', 'incomplete_expired') then
    return jsonb_build_object('outcome', 'stale');
  end if;
  if existing.stripe_subscription_id = row_data->>'stripe_subscription_id' and existing.status = 'canceled'
      and row_data->>'status' <> 'canceled' then return jsonb_build_object('outcome', 'stale'); end if;
  insert into public.billing_subscriptions(owner_id, stripe_customer_id, stripe_subscription_id,
    stripe_product_id, stripe_price_id, status, billing_interval, current_period_end, cancel_at_period_end, last_event_created, updated_at)
  values (owner, row_data->>'stripe_customer_id', row_data->>'stripe_subscription_id', row_data->>'stripe_product_id',
    row_data->>'stripe_price_id', row_data->>'status', row_data->>'billing_interval', (row_data->>'current_period_end')::timestamptz,
    (row_data->>'cancel_at_period_end')::boolean, (row_data->>'last_event_created')::timestamptz, now())
  on conflict (owner_id) do update set stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id, stripe_product_id = excluded.stripe_product_id,
    stripe_price_id = excluded.stripe_price_id, status = excluded.status, billing_interval = excluded.billing_interval,
    current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
    last_event_created = excluded.last_event_created, updated_at = excluded.updated_at;
  insert into public.account_entitlements(owner_id, plan, status, source, matrix_version, current_period_end, updated_at)
  values (owner, grant_data->>'plan', grant_data->>'status', grant_data->>'source', (grant_data->>'matrix_version')::integer,
    (grant_data->>'current_period_end')::timestamptz, now())
  on conflict (owner_id) do update set plan = excluded.plan, status = excluded.status, source = excluded.source,
    matrix_version = excluded.matrix_version, current_period_end = excluded.current_period_end, updated_at = excluded.updated_at;
  return jsonb_build_object('outcome', 'applied');
end $$;

create function public.billing_reserve_checkout(p_owner uuid, p_interval text, p_params jsonb, p_previous uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare state public.billing_checkout_state%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text, 0));
  if not exists (select 1 from auth.users where id = p_owner) then raise exception 'Account unavailable'; end if;
  insert into public.billing_checkout_state(owner_id) values (p_owner) on conflict (owner_id) do nothing;
  select * into state from public.billing_checkout_state where owner_id = p_owner for update;
  if state.deleting then return jsonb_build_object('deleting', true); end if;
  if exists (select 1 from public.billing_subscriptions where owner_id = p_owner
      and status in ('active', 'trialing', 'past_due', 'incomplete', 'unpaid', 'paused')) then raise exception 'Subscription already exists'; end if;
  -- Only the server passes p_previous, after Stripe confirms the session is
  -- expired or its completed subscription has ended. Compare-and-swap keeps
  -- competing replacements from creating separate attempts.
  if state.attempt is not null and (p_previous is null or state.attempt->>'id' <> p_previous::text) then return state.attempt; end if;
  if p_interval not in ('month', 'year') then raise exception 'Invalid interval'; end if;
  if not exists (select 1 from public.billing_subscriptions where owner_id = p_owner
      and stripe_customer_id = p_params->>'customerId') then raise exception 'Customer mismatch'; end if;
  state.attempt := jsonb_build_object('id', gen_random_uuid(), 'interval', p_interval,
    'params', p_params || jsonb_build_object('expiresAt', floor(extract(epoch from now()))::bigint + 3600));
  update public.billing_checkout_state set attempt = state.attempt, updated_at = now() where owner_id = p_owner;
  return state.attempt;
end $$;

create function public.billing_save_checkout(p_owner uuid, p_attempt uuid, p_session text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare state public.billing_checkout_state%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text, 0));
  select * into state from public.billing_checkout_state where owner_id = p_owner for update;
  if not found or state.deleting then return jsonb_build_object('deleting', true); end if;
  if state.attempt->>'id' <> p_attempt::text then raise exception 'Checkout changed'; end if;
  update public.billing_checkout_state set attempt = attempt || jsonb_build_object('session_id', p_session), updated_at = now()
    where owner_id = p_owner;
  return jsonb_build_object('deleting', false);
end $$;

create function public.billing_begin_deletion(p_owner uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare state public.billing_checkout_state%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text, 0));
  insert into public.billing_checkout_state(owner_id, deleting) values (p_owner, true)
    on conflict (owner_id) do update set deleting = true, updated_at = now() returning * into state;
  return jsonb_build_object('attempt', state.attempt);
end $$;

revoke all on function public.billing_link_customer(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_apply_event(jsonb) from public, anon, authenticated;
revoke all on function public.billing_reserve_checkout(uuid, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.billing_save_checkout(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.billing_begin_deletion(uuid) from public, anon, authenticated;
grant execute on function public.billing_link_customer(uuid, text) to service_role;
grant execute on function public.billing_apply_event(jsonb) to service_role;
grant execute on function public.billing_reserve_checkout(uuid, text, jsonb, uuid) to service_role;
grant execute on function public.billing_save_checkout(uuid, uuid, text) to service_role;
grant execute on function public.billing_begin_deletion(uuid) to service_role;

comment on table public.billing_checkout_state is 'Server-only pending checkout and account-deletion gate; never grants access.';
comment on table public.stripe_events is 'Webhook receipts committed atomically with billing and entitlement updates; version 0 receipts can be repaired once.';
