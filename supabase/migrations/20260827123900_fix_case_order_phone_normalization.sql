create or replace function public.nev_create_case_with_orders(
  p_customer_name text,
  p_whatsapp text,
  p_issue_type text,
  p_description text,
  p_priority text,
  p_assigned_to uuid,
  p_orders jsonb
)
returns public.nev_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_phone text := regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g');
  v_case public.nev_cases;
  v_order jsonb;
  v_system_id uuid;
  v_system_label text;
  v_amount numeric;
  v_total numeric := 0;
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  if char_length(v_phone) not between 10 and 15 then raise exception 'WhatsApp inválido.'; end if;
  if not exists (select 1 from public.nev_profiles where user_id = p_assigned_to and active) then
    raise exception 'Responsável inválido.';
  end if;
  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) not between 1 and 20 then
    raise exception 'Informe de 1 a 20 pedidos.';
  end if;

  for v_order in select value from jsonb_array_elements(p_orders) loop
    if nullif(btrim(v_order ->> 'order_number'), '') is null then raise exception 'Informe o número de todos os pedidos.'; end if;
    if nullif(v_order ->> 'order_date', '') is null then raise exception 'Informe a data de todos os pedidos.'; end if;
    v_amount := (v_order ->> 'amount')::numeric;
    if v_amount is null or v_amount < 0 then raise exception 'Informe um valor válido em todos os pedidos.'; end if;
    v_total := v_total + round(v_amount, 2);
  end loop;

  insert into public.nev_customers(name, normalized_whatsapp, created_by)
  values (btrim(p_customer_name), v_phone, auth.uid())
  on conflict (normalized_whatsapp) do update set name = excluded.name, updated_at = now()
  returning id into v_customer_id;

  insert into public.nev_cases(
    customer_id, customer_name, whatsapp, order_value, issue_type,
    issue_description, priority, status, assigned_to, created_by,
    review_status, current_action_user
  ) values (
    v_customer_id, btrim(p_customer_name), v_phone, round(v_total, 2), p_issue_type,
    btrim(p_description), p_priority, 'open', p_assigned_to, auth.uid(),
    'draft', auth.uid()
  ) returning * into v_case;

  for v_order in select value from jsonb_array_elements(p_orders) loop
    v_system_id := null;
    if nullif(v_order ->> 'system_id', '') is not null then
      v_system_id := (v_order ->> 'system_id')::uuid;
      select label into v_system_label from public.nev_order_systems where id = v_system_id and active;
      if v_system_label is null then raise exception 'Sistema de pedido inválido.'; end if;
    else
      v_system_label := nullif(btrim(v_order ->> 'system_label'), '');
      if v_system_label is null then raise exception 'Informe o sistema de todos os pedidos.'; end if;
    end if;
    insert into public.nev_case_orders(case_id, system_id, system_label, order_number, order_date, amount, created_by)
    values (v_case.id, v_system_id, v_system_label, btrim(v_order ->> 'order_number'),
      (v_order ->> 'order_date')::date, round((v_order ->> 'amount')::numeric, 2), auth.uid());
  end loop;

  insert into public.nev_case_updates(case_id, author_id, kind, body, metadata)
  values (v_case.id, auth.uid(), 'status',
    jsonb_array_length(p_orders) || case when jsonb_array_length(p_orders) = 1 then ' pedido cadastrado.' else ' pedidos cadastrados.' end,
    jsonb_build_object('orders_count', jsonb_array_length(p_orders), 'orders_total', round(v_total, 2)));
  return v_case;
end;
$$;

revoke execute on function public.nev_create_case_with_orders(text,text,text,text,text,uuid,jsonb) from public, anon;
grant execute on function public.nev_create_case_with_orders(text,text,text,text,text,uuid,jsonb) to authenticated;
