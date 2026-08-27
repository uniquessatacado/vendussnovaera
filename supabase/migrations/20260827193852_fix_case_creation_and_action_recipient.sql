-- Compatibilidade com a tela anterior e roteamento exato da proxima acao.

alter table public.nev_cases
  alter column problem_started_at set default current_date;

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
  v_problem_date date;
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
    v_problem_date := least(coalesce(v_problem_date, (v_order ->> 'order_date')::date), (v_order ->> 'order_date')::date);
  end loop;

  insert into public.nev_customers(name, normalized_whatsapp, created_by)
  values (btrim(p_customer_name), v_phone, auth.uid())
  on conflict (normalized_whatsapp) do update set name = excluded.name, updated_at = now()
  returning id into v_customer_id;

  insert into public.nev_cases(
    customer_id, customer_name, whatsapp, order_value, issue_type,
    issue_description, priority, status, assigned_to, created_by,
    review_status, current_action_user, problem_started_at,
    workflow_stage, customer_mood, mood_updated_by
  ) values (
    v_customer_id, btrim(p_customer_name), v_phone, round(v_total, 2), p_issue_type,
    btrim(p_description), p_priority, 'open', p_assigned_to, auth.uid(),
    'draft', auth.uid(), v_problem_date, 'in_service', 'normal', auth.uid()
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

create or replace function nev_private.nev_close_case_action_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.current_action_user is distinct from new.current_action_user
     or old.status is distinct from new.status
     or old.workflow_stage is distinct from new.workflow_stage then
    update public.nev_notifications
    set action_required = false,
        read_at = coalesce(read_at, now())
    where entity_type = 'case'
      and entity_id = new.id
      and action_required;
  end if;
  return new;
end;
$$;

drop trigger if exists nev_cases_close_old_action_alerts on public.nev_cases;
create trigger nev_cases_close_old_action_alerts
after update of current_action_user, status, workflow_stage on public.nev_cases
for each row execute function nev_private.nev_close_case_action_alerts();

create or replace function public.nev_create_case_flow(
  p_customer_name text,
  p_whatsapp text,
  p_issue_type text,
  p_description text,
  p_priority text,
  p_assigned_to uuid,
  p_orders jsonb,
  p_customer_mood text,
  p_next_step text,
  p_action_user uuid default null,
  p_action_note text default null
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
  v_problem_date date;
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  if char_length(v_phone) not between 10 and 15 then raise exception 'WhatsApp inválido.'; end if;
  if p_customer_mood not in ('very_upset', 'upset', 'normal', 'calm') then raise exception 'Selecione o humor atual do cliente.'; end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then raise exception 'Prioridade inválida.'; end if;
  if p_next_step not in ('in_service', 'request_action') then raise exception 'Escolha o próximo passo.'; end if;
  if not exists (select 1 from public.nev_profiles where user_id = p_assigned_to and active) then raise exception 'Responsável inválido.'; end if;
  if p_next_step = 'request_action' then
    if p_action_user is null or not exists (select 1 from public.nev_profiles where user_id = p_action_user and active) then raise exception 'Escolha quem precisa agir.'; end if;
    if p_action_user = auth.uid() then raise exception 'A próxima ação deve ser enviada para outro usuário.'; end if;
    if nullif(btrim(coalesce(p_action_note, '')), '') is null then raise exception 'Explique qual ação precisa ser realizada.'; end if;
  end if;
  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) not between 1 and 20 then raise exception 'Informe de 1 a 20 pedidos.'; end if;

  for v_order in select value from jsonb_array_elements(p_orders) loop
    if nullif(btrim(v_order ->> 'order_number'), '') is null then raise exception 'Informe o número de todos os pedidos.'; end if;
    if nullif(v_order ->> 'order_date', '') is null then raise exception 'Informe a data de todos os pedidos.'; end if;
    v_amount := (v_order ->> 'amount')::numeric;
    if v_amount is null or v_amount < 0 then raise exception 'Informe um valor válido em todos os pedidos.'; end if;
    v_total := v_total + round(v_amount, 2);
    v_problem_date := least(coalesce(v_problem_date, (v_order ->> 'order_date')::date), (v_order ->> 'order_date')::date);
  end loop;

  insert into public.nev_customers(name, normalized_whatsapp, created_by)
  values (btrim(p_customer_name), v_phone, auth.uid())
  on conflict (normalized_whatsapp) do update set name = excluded.name, updated_at = now()
  returning id into v_customer_id;

  insert into public.nev_cases(
    customer_id, customer_name, whatsapp, order_value, issue_type, issue_description,
    priority, status, assigned_to, created_by, review_status, current_action_user,
    workflow_stage, customer_mood, mood_updated_by, problem_started_at,
    review_requested_to, review_requested_at
  ) values (
    v_customer_id, btrim(p_customer_name), v_phone, round(v_total, 2), p_issue_type, btrim(p_description),
    p_priority, 'in_progress', p_assigned_to, auth.uid(),
    case when p_next_step = 'request_action' then 'pending' else 'draft' end,
    case when p_next_step = 'request_action' then p_action_user else auth.uid() end,
    case when p_next_step = 'request_action' then 'awaiting_internal_action' else 'in_service' end,
    p_customer_mood, auth.uid(), v_problem_date,
    case when p_next_step = 'request_action' then p_action_user else null end,
    case when p_next_step = 'request_action' then now() else null end
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

  insert into public.nev_case_updates(case_id, author_id, recipient_id, kind, body, metadata)
  values (v_case.id, auth.uid(), case when p_next_step = 'request_action' then p_action_user else null end, 'status',
    case when p_next_step = 'request_action' then 'Atendimento cadastrado e ação solicitada: ' || btrim(p_action_note)
         else 'Atendimento iniciado e mantido com o atendente.' end,
    jsonb_build_object('customer_mood', p_customer_mood, 'orders_count', jsonb_array_length(p_orders), 'orders_total', round(v_total, 2)));

  if p_next_step = 'request_action' then
    insert into public.nev_case_actions(case_id, requested_by, requested_to, request_note, customer_mood)
    values (v_case.id, auth.uid(), p_action_user, btrim(p_action_note), p_customer_mood);
    insert into public.nev_notifications(recipient_id, actor_id, title, body, entity_type, entity_id, action_required)
    values (p_action_user, auth.uid(), 'Ação solicitada em atendimento', btrim(p_action_note), 'case', v_case.id, true);
  end if;
  return v_case;
end;
$$;

create or replace function public.nev_request_case_action(
  p_case_id uuid,
  p_recipient_id uuid,
  p_customer_mood text,
  p_note text
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_number bigint;
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  if p_customer_mood not in ('very_upset', 'upset', 'normal', 'calm') then raise exception 'Selecione o humor atual do cliente.'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Explique qual ação precisa ser realizada.'; end if;
  if p_recipient_id = auth.uid() then raise exception 'A próxima ação deve ser enviada para outro usuário.'; end if;
  if not exists (select 1 from public.nev_profiles where user_id = p_recipient_id and active) then raise exception 'Usuário inválido.'; end if;

  update public.nev_case_actions set status = 'cancelled', released_at = now()
  where case_id = p_case_id and status = 'pending';
  insert into public.nev_case_actions(case_id, requested_by, requested_to, request_note, customer_mood)
  values (p_case_id, auth.uid(), p_recipient_id, btrim(p_note), p_customer_mood);
  update public.nev_cases set workflow_stage = 'awaiting_internal_action', status = 'in_progress',
    review_status = 'pending', review_requested_to = p_recipient_id, review_requested_at = now(),
    current_action_user = p_recipient_id, customer_mood = p_customer_mood,
    mood_updated_at = now(), mood_updated_by = auth.uid(), customer_waiting_since = null
  where id = p_case_id returning case_number into v_number;
  if not found then raise exception 'Atendimento não encontrado.'; end if;
  insert into public.nev_case_updates(case_id, author_id, recipient_id, kind, body, metadata)
  values (p_case_id, auth.uid(), p_recipient_id, 'assignment', btrim(p_note), jsonb_build_object('customer_mood', p_customer_mood));
  insert into public.nev_notifications(recipient_id, actor_id, title, body, entity_type, entity_id, action_required)
  values (p_recipient_id, auth.uid(), 'Sua ação é necessária', 'Atendimento #' || lpad(v_number::text, 5, '0') || ': ' || btrim(p_note), 'case', p_case_id, true);
end;
$$;

create or replace function public.nev_release_case_options(
  p_case_id uuid,
  p_options text[],
  p_assign_to uuid,
  p_note text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_number bigint; v_allowed text[] := array['reorder','store_credit_venduss','store_credit_zero19','installment_refund','other'];
begin
  if not nev_private.nev_is_super_admin() then raise exception 'Somente Clovis pode liberar as opções de conclusão.'; end if;
  if p_options is null or cardinality(p_options) < 1 or exists (select 1 from unnest(p_options) x where not (x = any(v_allowed))) then raise exception 'Escolha pelo menos uma opção válida.'; end if;
  if p_assign_to = auth.uid() then raise exception 'Escolha quem receberá a próxima ação; não envie para você mesmo.'; end if;
  if not exists (select 1 from public.nev_profiles where user_id = p_assign_to and active) then raise exception 'Escolha um usuário ativo para continuar.'; end if;

  update public.nev_case_actions set status = 'released', released_by = auth.uid(), released_to = p_assign_to,
    release_note = nullif(btrim(coalesce(p_note, '')), ''), available_resolutions = p_options,
    released_at = now()
  where case_id = p_case_id and status = 'pending';
  update public.nev_cases set workflow_stage = 'options_released', review_status = 'approved',
    review_decided_at = now(), review_decided_by = auth.uid(), review_note = nullif(btrim(coalesce(p_note, '')), ''),
    available_resolutions = p_options, options_released_at = now(), options_released_by = auth.uid(),
    assigned_to = p_assign_to, current_action_user = p_assign_to
  where id = p_case_id returning case_number into v_number;
  if not found then raise exception 'Atendimento não encontrado.'; end if;
  insert into public.nev_case_updates(case_id, author_id, recipient_id, kind, body, metadata)
  values (p_case_id, auth.uid(), p_assign_to, 'approval',
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Opções de conclusão liberadas. Entre em contato com o cliente.'),
    jsonb_build_object('available_resolutions', p_options));
  insert into public.nev_notifications(recipient_id, actor_id, title, body, entity_type, entity_id, action_required)
  values (p_assign_to, auth.uid(), 'Opções liberadas: fale com o cliente',
    'Atendimento #' || lpad(v_number::text, 5, '0') || ' está aguardando novo contato.', 'case', p_case_id, true);
end;
$$;

-- Encerra alertas antigos que nao correspondem mais a proxima pessoa responsavel.
update public.nev_notifications n
set action_required = false,
    read_at = coalesce(n.read_at, now())
where n.entity_type = 'case'
  and n.action_required
  and not exists (
    select 1
    from public.nev_cases c
    where c.id = n.entity_id
      and c.current_action_user = n.recipient_id
      and c.status not in ('resolved', 'cancelled')
  );

revoke execute on function public.nev_create_case_with_orders(text,text,text,text,text,uuid,jsonb) from public, anon;
revoke execute on function public.nev_create_case_flow(text,text,text,text,text,uuid,jsonb,text,text,uuid,text) from public, anon;
revoke execute on function public.nev_request_case_action(uuid,uuid,text,text) from public, anon;
revoke execute on function public.nev_release_case_options(uuid,text[],uuid,text) from public, anon;
grant execute on function public.nev_create_case_with_orders(text,text,text,text,text,uuid,jsonb) to authenticated;
grant execute on function public.nev_create_case_flow(text,text,text,text,text,uuid,jsonb,text,text,uuid,text) to authenticated;
grant execute on function public.nev_request_case_action(uuid,uuid,text,text) to authenticated;
grant execute on function public.nev_release_case_options(uuid,text[],uuid,text) to authenticated;
