begin;
-- Synthetic identity, always rolled back together with the test data.
insert into auth.users(id) values ('33333333-3333-4333-8333-333333333333');
insert into auth.users(id) values ('44444444-4444-4444-8444-444444444444');

do $$
declare
  owner uuid := '33333333-3333-4333-8333-333333333333';
  event jsonb;
  first_attempt jsonb;
  second_attempt jsonb;
  result jsonb;
begin
  perform public.billing_link_customer(owner, 'cus_transaction_test');
  first_attempt := public.billing_reserve_checkout(owner, 'month', '{"customerId":"cus_transaction_test"}'::jsonb);
  second_attempt := public.billing_reserve_checkout(owner, 'month', '{"customerId":"cus_transaction_test"}'::jsonb);
  assert first_attempt->>'id' = second_attempt->>'id', 'two requests must reserve the same checkout';
  perform public.billing_begin_deletion(owner);
  result := public.billing_reserve_checkout(owner, 'year', '{"customerId":"cus_transaction_test"}'::jsonb);
  assert (result->>'deleting')::boolean, 'deletion must close the checkout gate';
  result := public.billing_save_checkout(owner, (first_attempt->>'id')::uuid, 'cs_inflight');
  assert (result->>'deleting')::boolean, 'a checkout returning after deletion starts must be refused';

  event := jsonb_build_object('eventId', 'evt_transaction_test', 'eventType', 'customer.subscription.updated',
    'ownerId', owner, 'customerId', 'cus_transaction_test', 'mode', 'subscription',
    'row', jsonb_build_object('stripe_customer_id', 'cus_transaction_test', 'stripe_subscription_id', 'sub_transaction_test',
      'status', 'active', 'billing_interval', 'month', 'current_period_end', '2030-01-01T00:00:00Z',
      'cancel_at_period_end', false, 'last_event_created', '2026-09-12T00:00:00Z'),
    'grant', jsonb_build_object('plan', 'invalid_plan', 'status', 'active', 'source', 'stripe', 'matrix_version', 1,
      'current_period_end', '2030-01-01T00:00:00Z'));
  begin
    perform public.billing_apply_event(event);
    raise exception 'Expected the entitlement constraint to fail';
  exception when check_violation then null;
  end;
  assert not exists (select 1 from public.stripe_events where id = 'evt_transaction_test'), 'failed transaction must not retain its receipt';
  assert (select stripe_subscription_id is null from public.billing_subscriptions where owner_id = owner), 'subscription write must roll back too';
  event := jsonb_set(event, '{grant,plan}', '"consumer"'::jsonb);
  result := public.billing_apply_event(event);
  assert result->>'outcome' = 'applied', 'retry must finish the failed transaction';
  assert (select plan = 'consumer' from public.account_entitlements where owner_id = owner);
  result := public.billing_apply_event(event);
  assert result->>'outcome' = 'replay', 'completed retry must not apply twice';

  event := jsonb_set(event, '{eventId}', '"evt_stale_test"'::jsonb);
  event := jsonb_set(event, '{row,last_event_created}', '"2026-09-11T00:00:00Z"'::jsonb);
  result := public.billing_apply_event(event);
  assert result->>'outcome' = 'stale';

  -- Legacy receipts were inserted outside their updates. One re-delivery can
  -- repair a failed entitlement even when its subscription row already exists.
  insert into public.stripe_events(id, event_type) values ('evt_legacy_test', 'customer.subscription.updated');
  event := jsonb_set(event, '{eventId}', '"evt_legacy_test"'::jsonb);
  event := jsonb_set(event, '{row,last_event_created}', '"2026-09-12T00:00:00Z"'::jsonb);
  result := public.billing_apply_event(event);
  assert result->>'outcome' = 'applied';
  result := public.billing_apply_event(event);
  assert result->>'outcome' = 'replay';

  assert not has_function_privilege('anon', 'public.billing_apply_event(jsonb)', 'execute');
  assert not has_function_privilege('authenticated', 'public.billing_reserve_checkout(uuid,text,jsonb,uuid)', 'execute');
  assert not has_table_privilege('authenticated', 'public.billing_checkout_state', 'select');
  assert (select relrowsecurity from pg_class where oid = 'public.billing_checkout_state'::regclass);
end $$;

-- Exercise the actual role used by PostgREST, not just the database owner.
set local role service_role;
select public.billing_link_customer('44444444-4444-4444-8444-444444444444', 'cus_service_role_test');
select public.billing_reserve_checkout('44444444-4444-4444-8444-444444444444', 'month', '{"customerId":"cus_service_role_test"}'::jsonb);
select public.billing_begin_deletion('33333333-3333-4333-8333-333333333333');
select public.billing_apply_event('{"eventId":"evt_role_test","eventType":"unhandled","mode":"ignored"}'::jsonb);
reset role;
rollback;
