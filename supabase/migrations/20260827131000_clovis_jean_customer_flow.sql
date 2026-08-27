-- Fluxo operacional Clovis -> Jean, humor do cliente, PIX e tutoriais persistentes.

alter table public.nev_cases
  add column if not exists workflow_stage text not null default 'in_service',
  add column if not exists customer_mood text not null default 'normal',
  add column if not exists mood_updated_at timestamptz not null default now(),
  add column if not exists mood_updated_by uuid references public.nev_profiles(user_id) on delete set null,
  add column if not exists problem_started_at date,
  add column if not exists available_resolutions text[] not null default '{}'::text[],
  add column if not exists options_released_at timestamptz,
  add column if not exists options_released_by uuid references public.nev_profiles(user_id) on delete set null,
  add column if not exists customer_waiting_since timestamptz,
  add column if not exists last_customer_contact_at timestamptz,
  add column if not exists pix_key text;

alter table public.nev_cases drop constraint if exists nev_cases_workflow_stage_check;
alter table public.nev_cases add constraint nev_cases_workflow_stage_check check (workflow_stage in (
  'in_service', 'awaiting_internal_action', 'options_released',
  'waiting_customer', 'completed', 'renegotiating'
));
alter table public.nev_cases drop constraint if exists nev_cases_customer_mood_check;
alter table public.nev_cases add constraint nev_cases_customer_mood_check
  check (customer_mood in ('very_upset', 'upset', 'normal', 'calm'));

update public.nev_cases c
set problem_started_at = coalesce(
      (select min(o.order_date) from public.nev_case_orders o where o.case_id = c.id),
      c.created_at::date
    ),
    workflow_stage = case
      when c.status = 'resolved' then 'completed'
      when c.status = 'waiting_customer' then 'waiting_customer'
      when c.current_action_user is not null and c.review_status = 'pending' then 'awaiting_internal_action'
      when c.current_action_user is not null and c.review_status = 'approved' then 'awaiting_internal_action'
      else 'in_service'
    end
where c.problem_started_at is null;

alter table public.nev_cases alter column problem_started_at set not null;

alter table public.nev_refund_plans
  add column if not exists pix_key text;

alter table public.nev_tasks
  add column if not exists remind_at timestamptz;

alter table public.nev_case_updates drop constraint if exists nev_case_updates_kind_check;
alter table public.nev_case_updates add constraint nev_case_updates_kind_check
  check (kind in (
    'note', 'status', 'resolution', 'payment', 'attachment', 'approval',
    'assignment', 'renegotiation', 'mood', 'customer_contact'
  ));

create table public.nev_case_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.nev_cases(id) on delete cascade,
  requested_by uuid not null references public.nev_profiles(user_id) on delete restrict default auth.uid(),
  requested_to uuid not null references public.nev_profiles(user_id) on delete restrict,
  request_note text not null check (char_length(btrim(request_note)) between 2 and 4000),
  customer_mood text not null check (customer_mood in ('very_upset', 'upset', 'normal', 'calm')),
  status text not null default 'pending' check (status in ('pending', 'released', 'cancelled')),
  released_by uuid references public.nev_profiles(user_id) on delete set null,
  released_to uuid references public.nev_profiles(user_id) on delete set null,
  release_note text,
  available_resolutions text[] not null default '{}'::text[],
  requested_at timestamptz not null default now(),
  released_at timestamptz
);

create table public.nev_tutorial_dismissals (
  user_id uuid not null references public.nev_profiles(user_id) on delete cascade,
  tutorial_key text not null check (tutorial_key ~ '^[a-z0-9_]{2,80}$'),
  dismissed_at timestamptz not null default now(),
  primary key (user_id, tutorial_key)
);

create index nev_cases_stage_action_idx on public.nev_cases(workflow_stage, current_action_user, status);
create index nev_cases_problem_started_idx on public.nev_cases(problem_started_at, status);
create index nev_case_actions_pending_idx on public.nev_case_actions(requested_to, status, requested_at desc);
create index nev_tasks_reminder_idx on public.nev_tasks(waiting_on, remind_at, status);

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
end; $$;

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
end; $$;

create or replace function public.nev_start_customer_contact(p_case_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  update public.nev_cases set workflow_stage = 'in_service', status = 'in_progress',
    current_action_user = auth.uid(), last_customer_contact_at = now(), customer_waiting_since = null
  where id = p_case_id and (assigned_to = auth.uid() or current_action_user = auth.uid() or nev_private.nev_is_admin());
  if not found then raise exception 'Este atendimento não está atribuído a você.'; end if;
  insert into public.nev_case_updates(case_id, author_id, kind, body)
  values (p_case_id, auth.uid(), 'customer_contact', 'Novo atendimento com o cliente iniciado pelo WhatsApp.');
end; $$;

create or replace function public.nev_wait_customer(p_case_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  update public.nev_cases set workflow_stage = 'waiting_customer', status = 'waiting_customer',
    current_action_user = null, customer_waiting_since = now()
  where id = p_case_id and (assigned_to = auth.uid() or current_action_user = auth.uid() or nev_private.nev_is_admin());
  if not found then raise exception 'Você não pode alterar este atendimento.'; end if;
  insert into public.nev_case_updates(case_id, author_id, kind, body)
  values (p_case_id, auth.uid(), 'customer_contact', coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Aguardando resposta do cliente no WhatsApp.'));
end; $$;

create or replace function public.nev_complete_case_flow(
  p_case_id uuid,
  p_resolution_type text,
  p_amount numeric,
  p_notes text,
  p_customer_mood text,
  p_pix_key text default null,
  p_installments integer default null,
  p_first_due_date date default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_options text[]; v_assigned uuid;
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  if p_customer_mood not in ('very_upset', 'upset', 'normal', 'calm') then raise exception 'Selecione o humor final do cliente.'; end if;
  select available_resolutions, assigned_to into v_options, v_assigned from public.nev_cases where id = p_case_id for update;
  if not found then raise exception 'Atendimento não encontrado.'; end if;
  if auth.uid() <> v_assigned and not nev_private.nev_is_admin() then raise exception 'Somente o responsável pode concluir este atendimento.'; end if;
  if not (p_resolution_type = any(v_options)) and not nev_private.nev_is_super_admin() then raise exception 'Escolha uma das opções liberadas por Clovis.'; end if;
  if p_resolution_type = 'installment_refund' and nullif(btrim(coalesce(p_pix_key, '')), '') is null then raise exception 'Informe a chave PIX do cliente.'; end if;

  perform public.nev_apply_resolution(p_case_id, p_resolution_type, p_amount, p_notes, p_installments, p_first_due_date);
  update public.nev_cases set workflow_stage = 'completed', customer_mood = p_customer_mood,
    mood_updated_at = now(), mood_updated_by = auth.uid(), pix_key = nullif(btrim(coalesce(p_pix_key, '')), '')
  where id = p_case_id;
  if p_resolution_type = 'installment_refund' then
    update public.nev_refund_plans set pix_key = nullif(btrim(p_pix_key), '')
    where case_id = p_case_id and status = 'open';
  end if;
  insert into public.nev_case_updates(case_id, author_id, kind, body, metadata)
  values (p_case_id, auth.uid(), 'mood', 'Humor final do cliente registrado.', jsonb_build_object('customer_mood', p_customer_mood));
end; $$;

create or replace function public.nev_begin_renegotiation(p_case_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  update public.nev_cases set status = 'in_progress', workflow_stage = 'renegotiating', resolved_at = null,
    current_action_user = coalesce(assigned_to, auth.uid()), customer_waiting_since = null
  where id = p_case_id;
  if not found then raise exception 'Atendimento não encontrado.'; end if;
  insert into public.nev_case_updates(case_id, author_id, kind, body)
  values (p_case_id, auth.uid(), 'renegotiation', coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Renegociação iniciada porque o cliente mudou a solução.'));
end; $$;

create or replace function public.nev_dismiss_tutorial(p_tutorial_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  if p_tutorial_key !~ '^[a-z0-9_]{2,80}$' then raise exception 'Tutorial inválido.'; end if;
  insert into public.nev_tutorial_dismissals(user_id, tutorial_key)
  values (auth.uid(), p_tutorial_key)
  on conflict (user_id, tutorial_key) do update set dismissed_at = now();
end; $$;

create or replace function public.nev_create_scheduled_task(
  p_title text,
  p_description text,
  p_priority text,
  p_assigned_to uuid,
  p_due_at timestamptz default null,
  p_remind_at timestamptz default null
)
returns public.nev_tasks language plpgsql security definer set search_path = '' as $$
declare v_task public.nev_tasks;
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  if not exists (select 1 from public.nev_profiles where user_id = p_assigned_to and active) then raise exception 'Responsável inválido.'; end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then raise exception 'Prioridade inválida.'; end if;
  if p_due_at is not null and p_remind_at is not null and p_remind_at > p_due_at then raise exception 'O alerta não pode ficar depois do prazo.'; end if;
  insert into public.nev_tasks(title, description, priority, created_by, assigned_to, waiting_on, due_at, remind_at)
  values (btrim(p_title), btrim(coalesce(p_description, '')), p_priority, auth.uid(), p_assigned_to, p_assigned_to, p_due_at, p_remind_at)
  returning * into v_task;
  insert into public.nev_task_updates(task_id, author_id, recipient_id, kind, body)
  values (v_task.id, auth.uid(), p_assigned_to, 'status',
    case when p_assigned_to = auth.uid() then 'Tarefa pessoal programada.' else 'Tarefa criada e enviada ao responsável.' end);
  insert into public.nev_notifications(recipient_id, actor_id, title, body, entity_type, entity_id, action_required)
  values (p_assigned_to, auth.uid(), case when p_assigned_to = auth.uid() then 'Lembrete programado' else 'Nova tarefa para você' end,
    v_task.title, 'task', v_task.id, p_remind_at is null or p_remind_at <= now());
  return v_task;
end; $$;

alter table public.nev_case_actions enable row level security;
alter table public.nev_tutorial_dismissals enable row level security;
create policy nev_case_actions_staff on public.nev_case_actions for select to authenticated using (nev_private.nev_is_active_staff());
create policy nev_tutorial_dismissals_own on public.nev_tutorial_dismissals for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.nev_case_actions, public.nev_tutorial_dismissals from public, anon, authenticated;
grant select on public.nev_case_actions, public.nev_tutorial_dismissals to authenticated;

revoke execute on function public.nev_create_case_flow(text,text,text,text,text,uuid,jsonb,text,text,uuid,text) from public, anon;
revoke execute on function public.nev_request_case_action(uuid,uuid,text,text) from public, anon;
revoke execute on function public.nev_release_case_options(uuid,text[],uuid,text) from public, anon;
revoke execute on function public.nev_start_customer_contact(uuid) from public, anon;
revoke execute on function public.nev_wait_customer(uuid,text) from public, anon;
revoke execute on function public.nev_complete_case_flow(uuid,text,numeric,text,text,text,integer,date) from public, anon;
revoke execute on function public.nev_dismiss_tutorial(text) from public, anon;
revoke execute on function public.nev_create_scheduled_task(text,text,text,uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.nev_create_case_flow(text,text,text,text,text,uuid,jsonb,text,text,uuid,text) to authenticated;
grant execute on function public.nev_request_case_action(uuid,uuid,text,text) to authenticated;
grant execute on function public.nev_release_case_options(uuid,text[],uuid,text) to authenticated;
grant execute on function public.nev_start_customer_contact(uuid) to authenticated;
grant execute on function public.nev_wait_customer(uuid,text) to authenticated;
grant execute on function public.nev_complete_case_flow(uuid,text,numeric,text,text,text,integer,date) to authenticated;
grant execute on function public.nev_dismiss_tutorial(text) to authenticated;
grant execute on function public.nev_create_scheduled_task(text,text,text,uuid,timestamptz,timestamptz) to authenticated;

drop trigger if exists nev_case_actions_audit on public.nev_case_actions;
create trigger nev_case_actions_audit after insert or update or delete on public.nev_case_actions
for each row execute function nev_private.nev_audit_change();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'nev_case_actions') then
    alter publication supabase_realtime add table public.nev_case_actions;
  end if;
end $$;

comment on column public.nev_cases.customer_mood is 'Humor atual informado pelo atendente em todo repasse e na conclusão';
comment on column public.nev_cases.pix_key is 'Chave PIX do cliente para execução do reembolso';
