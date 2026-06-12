create or replace function public.process_revenuecat_credit_event(
  p_event_id text,
  p_user_id uuid,
  p_app_user_id text,
  p_product_id text,
  p_credit_amount integer,
  p_event_type text,
  p_raw_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_row public.revenuecat_events%rowtype;
  v_inserted_event_id uuid;
  v_ledger_id uuid;
begin
  if p_event_id is null or length(trim(p_event_id)) = 0 then
    raise exception 'REVENUECAT_EVENT_ID_REQUIRED';
  end if;

  if p_user_id is null or p_app_user_id is null or length(trim(p_app_user_id)) = 0 then
    raise exception 'REVENUECAT_APP_USER_ID_REQUIRED';
  end if;

  if p_product_id is null or length(trim(p_product_id)) = 0 then
    raise exception 'REVENUECAT_PRODUCT_ID_REQUIRED';
  end if;

  if p_credit_amount is null or p_credit_amount <= 0 then
    raise exception 'REVENUECAT_CREDIT_AMOUNT_REQUIRED';
  end if;

  insert into public.revenuecat_events (
    app_user_id,
    credit_amount,
    event_id,
    product_id,
    processed_status,
    raw_event,
    user_id
  )
  values (
    p_app_user_id,
    p_credit_amount,
    p_event_id,
    p_product_id,
    'processing',
    coalesce(p_raw_event, '{}'::jsonb),
    p_user_id
  )
  on conflict (event_id) do nothing
  returning id into v_inserted_event_id;

  if v_inserted_event_id is null then
    select *
    into v_event_row
    from public.revenuecat_events
    where event_id = p_event_id;

    return jsonb_build_object(
      'duplicate', true,
      'eventId', v_event_row.id,
      'ledgerId', v_event_row.credit_ledger_id
    );
  end if;

  insert into public.credit_ledger (
    credit_delta,
    event_type,
    metadata,
    resource_type,
    user_id
  )
  values (
    p_credit_amount,
    'revenuecat_purchase',
    jsonb_build_object(
      'event_id', p_event_id,
      'product_id', p_product_id,
      'revenuecat_type', p_event_type
    ),
    'revenuecat_purchase',
    p_user_id
  )
  returning id into v_ledger_id;

  update public.revenuecat_events
  set
    credit_ledger_id = v_ledger_id,
    processed_status = 'processed'
  where id = v_inserted_event_id
  returning * into v_event_row;

  return jsonb_build_object(
    'creditsGranted', p_credit_amount,
    'duplicate', false,
    'eventId', v_event_row.id,
    'ledgerId', v_ledger_id
  );
exception
  when others then
    if v_inserted_event_id is not null then
      update public.revenuecat_events
      set processed_status = 'failed'
      where id = v_inserted_event_id;
    end if;

    raise;
end;
$$;
