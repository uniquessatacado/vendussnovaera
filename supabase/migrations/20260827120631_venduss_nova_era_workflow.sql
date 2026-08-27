-- Venduss Nova Era: workflow completo, anexos, tarefas, auditoria e reembolsos.

alter table public.nev_profiles
  add column if not exists is_super_admin boolean not null default false,
  add column if not exists notify_changes boolean not null default true;

update public.nev_profiles
set is_super_admin = true
where lower(email) = 'sistemasuniquess@gmail.com';

create or replace function nev_private.nev_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.nev_profiles
    where user_id = (select auth.uid())
      and active = true
      and is_super_admin = true
  );
$$;

revoke all on function nev_private.nev_is_super_admin() from public;
grant execute on function nev_private.nev_is_super_admin() to authenticated;

create table public.nev_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  normalized_whatsapp text not null unique check (normalized_whatsapp ~ '^[0-9]{10,15}$'),
  created_by uuid references public.nev_profiles(user_id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.nev_customers (name, normalized_whatsapp, created_by, created_at)
select distinct on (whatsapp) customer_name, whatsapp, created_by, created_at
from public.nev_cases
order by whatsapp, created_at
on conflict (normalized_whatsapp) do nothing;

alter table public.nev_cases
  add column if not exists customer_id uuid references public.nev_customers(id) on delete restrict,
  add column if not exists review_status text not null default 'draft',
  add column if not exists review_requested_to uuid references public.nev_profiles(user_id) on delete set null,
  add column if not exists review_requested_at timestamptz,
  add column if not exists review_decided_at timestamptz,
  add column if not exists review_decided_by uuid references public.nev_profiles(user_id) on delete set null,
  add column if not exists review_note text,
  add column if not exists current_action_user uuid references public.nev_profiles(user_id) on delete set null,
  add column if not exists last_activity_at timestamptz not null default now();

update public.nev_cases c
set customer_id = cu.id
from public.nev_customers cu
where c.customer_id is null and cu.normalized_whatsapp = c.whatsapp;

update public.nev_cases
set review_status = 'approved',
    current_action_user = coalesce(assigned_to, created_by)
where review_status = 'draft' and created_at < now();

alter table public.nev_cases
  alter column customer_id set not null;

alter table public.nev_cases drop constraint if exists nev_cases_review_status_check;
alter table public.nev_cases add constraint nev_cases_review_status_check
  check (review_status in ('draft', 'pending', 'approved', 'changes_requested'));

alter table public.nev_cases drop constraint if exists nev_cases_resolution_type_check;
alter table public.nev_cases add constraint nev_cases_resolution_type_check
  check (resolution_type is null or resolution_type in (
    'store_credit', 'store_credit_venduss', 'store_credit_zero19',
    'reorder', 'installment_refund', 'other'
  ));

alter table public.nev_case_updates
  add column if not exists recipient_id uuid references public.nev_profiles(user_id) on delete set null,
  add column if not exists read_at timestamptz;

alter table public.nev_case_updates drop constraint if exists nev_case_updates_kind_check;
alter table public.nev_case_updates add constraint nev_case_updates_kind_check
  check (kind in ('note', 'status', 'resolution', 'payment', 'attachment', 'approval', 'assignment', 'renegotiation'));

create table public.nev_case_approvals (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.nev_cases(id) on delete cascade,
  requested_by uuid not null references public.nev_profiles(user_id) on delete restrict default auth.uid(),
  reviewer_id uuid not null references public.nev_profiles(user_id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'approved', 'changes_requested', 'cancelled')),
  request_note text,
  response_note text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (case_id, requested_at)
);

create table public.nev_case_attachments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.nev_cases(id) on delete cascade,
  uploaded_by uuid references public.nev_profiles(user_id) on delete set null default auth.uid(),
  category text not null check (category in ('payment_receipt', 'shipping', 'problem', 'other')),
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null check (mime_type like 'image/%' or mime_type = 'application/pdf'),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);

create table public.nev_case_resolutions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.nev_cases(id) on delete cascade,
  version integer not null,
  resolution_type text not null check (resolution_type in (
    'store_credit', 'store_credit_venduss', 'store_credit_zero19',
    'reorder', 'installment_refund', 'other'
  )),
  amount numeric(12,2) not null check (amount >= 0),
  notes text,
  created_by uuid references public.nev_profiles(user_id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (case_id, version)
);

alter table public.nev_refund_plans
  add column if not exists resolution_id uuid references public.nev_case_resolutions(id) on delete set null,
  add column if not exists cancelled_reason text;

alter table public.nev_refund_installments
  add column if not exists paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  add column if not exists postponed_reason text;

alter table public.nev_refund_installments drop constraint if exists nev_refund_installments_status_check;
alter table public.nev_refund_installments add constraint nev_refund_installments_status_check
  check (status in ('pending', 'partial', 'paid', 'cancelled'));

create table public.nev_refund_payments (
  id uuid primary key default gen_random_uuid(),
  installment_id uuid not null references public.nev_refund_installments(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  notes text,
  paid_by uuid references public.nev_profiles(user_id) on delete set null default auth.uid(),
  paid_at timestamptz not null default now()
);

create table public.nev_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 180),
  description text not null default '',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'awaiting_creator', 'done', 'cancelled')),
  created_by uuid not null references public.nev_profiles(user_id) on delete restrict default auth.uid(),
  assigned_to uuid not null references public.nev_profiles(user_id) on delete restrict,
  waiting_on uuid references public.nev_profiles(user_id) on delete set null,
  due_at timestamptz,
  snoozed_until timestamptz,
  snooze_reason text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.nev_task_updates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.nev_tasks(id) on delete cascade,
  author_id uuid references public.nev_profiles(user_id) on delete set null default auth.uid(),
  recipient_id uuid references public.nev_profiles(user_id) on delete set null,
  kind text not null default 'note' check (kind in ('note', 'question', 'answer', 'status', 'snooze')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table public.nev_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.nev_profiles(user_id) on delete cascade,
  actor_id uuid references public.nev_profiles(user_id) on delete set null default auth.uid(),
  title text not null,
  body text not null default '',
  entity_type text not null check (entity_type in ('case', 'task', 'refund', 'system')),
  entity_id uuid,
  action_required boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table public.nev_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.nev_profiles(user_id) on delete set null default auth.uid(),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index nev_customers_phone_idx on public.nev_customers(normalized_whatsapp);
create index nev_cases_action_idx on public.nev_cases(current_action_user, review_status, status);
create index nev_cases_activity_idx on public.nev_cases(last_activity_at desc);
create index nev_approvals_reviewer_idx on public.nev_case_approvals(reviewer_id, status, requested_at desc);
create index nev_attachments_case_idx on public.nev_case_attachments(case_id, created_at desc);
create index nev_tasks_action_idx on public.nev_tasks(waiting_on, assigned_to, status, due_at);
create index nev_task_updates_task_idx on public.nev_task_updates(task_id, created_at desc);
create index nev_notifications_recipient_idx on public.nev_notifications(recipient_id, read_at, created_at desc);
create index nev_audit_created_idx on public.nev_audit_events(created_at desc);
create index nev_refund_payments_installment_idx on public.nev_refund_payments(installment_id, paid_at desc);

create trigger nev_customers_set_updated_at before update on public.nev_customers
for each row execute function nev_private.nev_set_updated_at();
create trigger nev_tasks_set_updated_at before update on public.nev_tasks
for each row execute function nev_private.nev_set_updated_at();

create or replace function nev_private.nev_touch_case()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.nev_cases
  set last_activity_at = now()
  where id = case when tg_op = 'DELETE' then old.case_id else new.case_id end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger nev_updates_touch_case after insert on public.nev_case_updates
for each row execute function nev_private.nev_touch_case();
create trigger nev_attachments_touch_case after insert or delete on public.nev_case_attachments
for each row execute function nev_private.nev_touch_case();

create or replace function public.nev_create_case(
  p_customer_name text,
  p_whatsapp text,
  p_order_value numeric,
  p_issue_type text,
  p_description text,
  p_priority text,
  p_assigned_to uuid
)
returns public.nev_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_phone text := regexp_replace(coalesce(p_whatsapp, ''), '\\D', '', 'g');
  v_case public.nev_cases;
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  if char_length(v_phone) not between 10 and 15 then raise exception 'WhatsApp inválido.'; end if;
  if not exists (select 1 from public.nev_profiles where user_id = p_assigned_to and active) then
    raise exception 'Responsável inválido.';
  end if;

  insert into public.nev_customers (name, normalized_whatsapp, created_by)
  values (btrim(p_customer_name), v_phone, auth.uid())
  on conflict (normalized_whatsapp) do update
    set name = excluded.name, updated_at = now()
  returning id into v_customer_id;

  insert into public.nev_cases (
    customer_id, customer_name, whatsapp, order_value, issue_type,
    issue_description, priority, status, assigned_to, created_by,
    review_status, current_action_user
  ) values (
    v_customer_id, btrim(p_customer_name), v_phone, p_order_value, p_issue_type,
    btrim(p_description), p_priority, 'open', p_assigned_to, auth.uid(),
    'draft', auth.uid()
  ) returning * into v_case;

  insert into public.nev_case_updates(case_id, author_id, kind, body)
  values (v_case.id, auth.uid(), 'status', 'Atendimento cadastrado e incluído na fila.');
  return v_case;
end;
$$;

create or replace function public.nev_request_case_review(
  p_case_id uuid,
  p_reviewer_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_number bigint;
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  if p_reviewer_id = auth.uid() then raise exception 'Escolha outro usuário para conferir.'; end if;
  if not exists (select 1 from public.nev_profiles where user_id = p_reviewer_id and active) then
    raise exception 'Revisor inválido.';
  end if;

  update public.nev_case_approvals set status = 'cancelled', decided_at = now()
  where case_id = p_case_id and status = 'pending';

  insert into public.nev_case_approvals(case_id, requested_by, reviewer_id, request_note)
  values (p_case_id, auth.uid(), p_reviewer_id, nullif(btrim(coalesce(p_note, '')), ''));

  update public.nev_cases
  set review_status = 'pending', review_requested_to = p_reviewer_id,
      review_requested_at = now(), review_decided_at = null,
      review_decided_by = null, review_note = null,
      current_action_user = p_reviewer_id, status = 'in_progress'
  where id = p_case_id returning case_number into v_number;
  if not found then raise exception 'Atendimento não encontrado.'; end if;

  insert into public.nev_case_updates(case_id, author_id, recipient_id, kind, body)
  values (p_case_id, auth.uid(), p_reviewer_id, 'approval',
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Conferência solicitada.'));
  insert into public.nev_notifications(recipient_id, actor_id, title, body, entity_type, entity_id, action_required)
  values (p_reviewer_id, auth.uid(), 'Atendimento aguardando sua conferência',
    'Confira o atendimento #' || lpad(v_number::text, 5, '0') || ' e libere a solução.', 'case', p_case_id, true);
end;
$$;

create or replace function public.nev_decide_case_review(
  p_case_id uuid,
  p_approved boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_requester uuid; v_number bigint;
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  select requested_by into v_requester
  from public.nev_case_approvals
  where case_id = p_case_id and status = 'pending'
    and (reviewer_id = auth.uid() or nev_private.nev_is_admin())
  order by requested_at desc limit 1 for update;
  if not found then raise exception 'Você não possui uma conferência pendente neste atendimento.'; end if;

  update public.nev_case_approvals
  set status = case when p_approved then 'approved' else 'changes_requested' end,
      response_note = nullif(btrim(coalesce(p_note, '')), ''), decided_at = now()
  where case_id = p_case_id and status = 'pending';

  update public.nev_cases
  set review_status = case when p_approved then 'approved' else 'changes_requested' end,
      review_decided_at = now(), review_decided_by = auth.uid(),
      review_note = nullif(btrim(coalesce(p_note, '')), ''),
      current_action_user = v_requester
  where id = p_case_id returning case_number into v_number;

  insert into public.nev_case_updates(case_id, author_id, recipient_id, kind, body, metadata)
  values (p_case_id, auth.uid(), v_requester, 'approval',
    case when p_approved then 'Conferência aprovada. As opções de solução foram liberadas.'
         else coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Ajustes solicitados antes de continuar.') end,
    jsonb_build_object('approved', p_approved));
  insert into public.nev_notifications(recipient_id, actor_id, title, body, entity_type, entity_id, action_required)
  values (v_requester, auth.uid(),
    case when p_approved then 'Atendimento liberado' else 'Atendimento precisa de ajustes' end,
    'A conferência do atendimento #' || lpad(v_number::text, 5, '0') || ' foi concluída.',
    'case', p_case_id, true);
end;
$$;

create or replace function public.nev_begin_renegotiation(p_case_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  update public.nev_cases
  set status = 'in_progress', resolved_at = null, current_action_user = auth.uid()
  where id = p_case_id;
  if not found then raise exception 'Atendimento não encontrado.'; end if;
  insert into public.nev_case_updates(case_id, author_id, kind, body)
  values (p_case_id, auth.uid(), 'renegotiation',
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Renegociação iniciada porque o cliente mudou a solução.'));
end;
$$;

create or replace function public.nev_apply_resolution(
  p_case_id uuid,
  p_resolution_type text,
  p_amount numeric,
  p_notes text,
  p_installments integer default null,
  p_first_due_date date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_id uuid; v_resolution_id uuid; v_version integer;
  v_total_cents bigint; v_base_cents bigint; v_remainder bigint;
  v_installment_cents bigint; v_index integer;
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  if not exists (select 1 from public.nev_cases where id = p_case_id and review_status = 'approved') then
    raise exception 'A solução só pode ser definida depois da conferência.';
  end if;
  if p_resolution_type not in ('store_credit', 'store_credit_venduss', 'store_credit_zero19', 'reorder', 'installment_refund', 'other') then
    raise exception 'Tipo de solução inválido.';
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'Informe um valor válido.'; end if;
  if p_resolution_type = 'installment_refund' then
    if p_amount <= 0 then raise exception 'O reembolso precisa ter valor maior que zero.'; end if;
    if p_installments is null or p_installments not between 1 and 36 then raise exception 'Informe de 1 a 36 parcelas.'; end if;
    if p_first_due_date is null then raise exception 'Informe a data da primeira parcela.'; end if;
  end if;

  update public.nev_case_resolutions set superseded_at = now()
  where case_id = p_case_id and superseded_at is null;
  update public.nev_refund_plans set status = 'cancelled', cancelled_reason = 'Solução renegociada'
  where case_id = p_case_id and status = 'open';
  update public.nev_refund_installments i set status = 'cancelled'
  from public.nev_refund_plans p
  where i.refund_plan_id = p.id and p.case_id = p_case_id and i.status in ('pending', 'partial');

  select coalesce(max(version), 0) + 1 into v_version
  from public.nev_case_resolutions where case_id = p_case_id;
  insert into public.nev_case_resolutions(case_id, version, resolution_type, amount, notes, created_by)
  values (p_case_id, v_version, p_resolution_type, round(p_amount, 2), nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_resolution_id;

  update public.nev_cases
  set status = 'resolved', resolution_type = p_resolution_type,
      resolution_amount = round(p_amount, 2),
      resolution_notes = nullif(btrim(coalesce(p_notes, '')), ''),
      resolved_at = now(), current_action_user = null
  where id = p_case_id;

  if p_resolution_type = 'installment_refund' then
    insert into public.nev_refund_plans(case_id, resolution_id, total_amount, installment_count, first_due_date, created_by)
    values (p_case_id, v_resolution_id, round(p_amount, 2), p_installments, p_first_due_date, auth.uid())
    returning id into v_plan_id;
    v_total_cents := round(p_amount * 100)::bigint;
    v_base_cents := v_total_cents / p_installments;
    v_remainder := v_total_cents % p_installments;
    for v_index in 1..p_installments loop
      v_installment_cents := v_base_cents + case when v_index <= v_remainder then 1 else 0 end;
      insert into public.nev_refund_installments(refund_plan_id, installment_number, amount, due_date)
      values (v_plan_id, v_index, v_installment_cents::numeric / 100,
        (p_first_due_date + make_interval(months => v_index - 1))::date);
    end loop;
  end if;

  insert into public.nev_case_updates(case_id, author_id, kind, body, metadata)
  values (p_case_id, auth.uid(), case when v_version > 1 then 'renegotiation' else 'resolution' end,
    coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Solução registrada.'),
    jsonb_build_object('version', v_version, 'resolution_type', p_resolution_type, 'amount', round(p_amount, 2)));
end;
$$;

create or replace function public.nev_record_installment_payment(
  p_installment_id uuid,
  p_amount numeric,
  p_notes text default null,
  p_new_due_date date default null,
  p_delay_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_installment public.nev_refund_installments; v_case_id uuid; v_remaining numeric;
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  select * into v_installment from public.nev_refund_installments
  where id = p_installment_id for update;
  if not found then raise exception 'Parcela não encontrada.'; end if;
  if v_installment.status in ('paid', 'cancelled') then raise exception 'Esta parcela não aceita novos pagamentos.'; end if;
  v_remaining := v_installment.amount - v_installment.paid_amount;
  if p_amount is null or p_amount <= 0 or p_amount > v_remaining then
    raise exception 'O pagamento deve ser maior que zero e não pode ultrapassar o saldo.';
  end if;
  insert into public.nev_refund_payments(installment_id, amount, notes, paid_by)
  values (p_installment_id, round(p_amount, 2), nullif(btrim(coalesce(p_notes, '')), ''), auth.uid());
  update public.nev_refund_installments
  set paid_amount = paid_amount + round(p_amount, 2),
      status = case when paid_amount + round(p_amount, 2) >= amount then 'paid' else 'partial' end,
      paid_at = case when paid_amount + round(p_amount, 2) >= amount then now() else paid_at end,
      due_date = case when paid_amount + round(p_amount, 2) < amount and p_new_due_date is not null then p_new_due_date else due_date end,
      postponed_reason = case when paid_amount + round(p_amount, 2) < amount and p_new_due_date is not null
        then nullif(btrim(coalesce(p_delay_reason, '')), '') else postponed_reason end,
      notes = nullif(btrim(coalesce(p_notes, '')), '')
  where id = p_installment_id;
  select p.case_id into v_case_id from public.nev_refund_plans p where p.id = v_installment.refund_plan_id;
  update public.nev_refund_plans p set status = case
    when exists (select 1 from public.nev_refund_installments i where i.refund_plan_id = p.id and i.status in ('pending', 'partial')) then 'open'
    else 'paid' end
  where p.id = v_installment.refund_plan_id;
  insert into public.nev_case_updates(case_id, author_id, kind, body, metadata)
  values (v_case_id, auth.uid(), 'payment',
    case when p_amount = v_remaining then 'Parcela paga integralmente.' else 'Pagamento parcial registrado.' end,
    jsonb_build_object('installment_id', p_installment_id, 'paid_amount', round(p_amount, 2), 'remaining', v_remaining - round(p_amount, 2), 'new_due_date', p_new_due_date));
end;
$$;

create or replace function public.nev_task_send_question(p_task_id uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_creator uuid; v_assigned uuid;
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  select created_by, assigned_to into v_creator, v_assigned from public.nev_tasks where id = p_task_id for update;
  if not found then raise exception 'Tarefa não encontrada.'; end if;
  if auth.uid() <> v_assigned and not nev_private.nev_is_admin() then raise exception 'Somente o responsável pode enviar a pergunta.'; end if;
  update public.nev_tasks set status = 'awaiting_creator', waiting_on = v_creator where id = p_task_id;
  insert into public.nev_task_updates(task_id, author_id, recipient_id, kind, body)
  values (p_task_id, auth.uid(), v_creator, 'question', btrim(p_body));
  insert into public.nev_notifications(recipient_id, actor_id, title, body, entity_type, entity_id, action_required)
  values (v_creator, auth.uid(), 'Pergunta em uma tarefa', btrim(p_body), 'task', p_task_id, true);
end; $$;

create or replace function public.nev_create_task(
  p_title text,
  p_description text,
  p_priority text,
  p_assigned_to uuid,
  p_due_at timestamptz default null
)
returns public.nev_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare v_task public.nev_tasks;
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  if not exists (select 1 from public.nev_profiles where user_id = p_assigned_to and active) then
    raise exception 'Responsável inválido.';
  end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then raise exception 'Prioridade inválida.'; end if;
  insert into public.nev_tasks(title, description, priority, created_by, assigned_to, waiting_on, due_at)
  values (btrim(p_title), btrim(coalesce(p_description, '')), p_priority, auth.uid(), p_assigned_to, p_assigned_to, p_due_at)
  returning * into v_task;
  insert into public.nev_task_updates(task_id, author_id, recipient_id, kind, body)
  values (v_task.id, auth.uid(), p_assigned_to, 'status', 'Tarefa criada e enviada ao responsável.');
  insert into public.nev_notifications(recipient_id, actor_id, title, body, entity_type, entity_id, action_required)
  values (p_assigned_to, auth.uid(), 'Nova tarefa para você', v_task.title, 'task', v_task.id, true);
  return v_task;
end;
$$;

create or replace function public.nev_task_answer(p_task_id uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_creator uuid; v_assigned uuid;
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  select created_by, assigned_to into v_creator, v_assigned from public.nev_tasks where id = p_task_id for update;
  if not found or auth.uid() <> v_creator then raise exception 'Somente quem criou a tarefa pode responder.'; end if;
  update public.nev_tasks set status = 'open', waiting_on = v_assigned where id = p_task_id;
  insert into public.nev_task_updates(task_id, author_id, recipient_id, kind, body)
  values (p_task_id, auth.uid(), v_assigned, 'answer', btrim(p_body));
  insert into public.nev_notifications(recipient_id, actor_id, title, body, entity_type, entity_id, action_required)
  values (v_assigned, auth.uid(), 'Resposta recebida na tarefa', btrim(p_body), 'task', p_task_id, true);
end; $$;

create or replace function public.nev_task_snooze(p_task_id uuid, p_until timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_assigned uuid;
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  select assigned_to into v_assigned from public.nev_tasks where id = p_task_id for update;
  if not found or (auth.uid() <> v_assigned and not nev_private.nev_is_admin()) then raise exception 'Você não pode adiar esta tarefa.'; end if;
  if p_until <= now() then raise exception 'Escolha uma data e hora futuras.'; end if;
  update public.nev_tasks set snoozed_until = p_until, snooze_reason = btrim(p_reason), waiting_on = v_assigned where id = p_task_id;
  insert into public.nev_task_updates(task_id, author_id, recipient_id, kind, body)
  values (p_task_id, auth.uid(), v_assigned, 'snooze', 'Adiada até ' || to_char(p_until at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '. Motivo: ' || btrim(p_reason));
end; $$;

create or replace function public.nev_task_complete(p_task_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_assigned uuid; v_creator uuid;
begin
  if not nev_private.nev_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  select assigned_to, created_by into v_assigned, v_creator from public.nev_tasks where id = p_task_id for update;
  if not found or (auth.uid() <> v_assigned and not nev_private.nev_is_admin()) then raise exception 'Você não pode concluir esta tarefa.'; end if;
  update public.nev_tasks set status = 'done', completed_at = now(), waiting_on = null where id = p_task_id;
  insert into public.nev_task_updates(task_id, author_id, recipient_id, kind, body)
  values (p_task_id, auth.uid(), v_creator, 'status', 'Tarefa marcada como concluída.');
  if v_creator <> auth.uid() then
    insert into public.nev_notifications(recipient_id, actor_id, title, body, entity_type, entity_id)
    values (v_creator, auth.uid(), 'Tarefa concluída', 'A tarefa foi marcada como pronta.', 'task', p_task_id);
  end if;
end; $$;

create or replace function public.nev_log_access(p_action text default 'login')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not nev_private.nev_is_active_staff() then return; end if;
  insert into public.nev_audit_events(actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_action, 'access', auth.uid()::text, '{}'::jsonb);
end; $$;

create or replace function nev_private.nev_audit_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row jsonb; v_id text;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_id := coalesce(v_row ->> 'id', v_row ->> 'user_id', '');
  insert into public.nev_audit_events(actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id,
    jsonb_build_object('changed_at', now(), 'record', v_row));
  return coalesce(new, old);
end; $$;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'nev_cases','nev_case_updates','nev_case_approvals','nev_case_attachments',
    'nev_case_resolutions','nev_refund_plans','nev_refund_installments','nev_refund_payments',
    'nev_tasks','nev_task_updates','nev_profiles'
  ] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_audit', v_table);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function nev_private.nev_audit_change()', v_table || '_audit', v_table);
  end loop;
end $$;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('nev-case-files', 'nev-case-files', false, 10485760,
  array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.nev_customers enable row level security;
alter table public.nev_case_approvals enable row level security;
alter table public.nev_case_attachments enable row level security;
alter table public.nev_case_resolutions enable row level security;
alter table public.nev_refund_payments enable row level security;
alter table public.nev_tasks enable row level security;
alter table public.nev_task_updates enable row level security;
alter table public.nev_notifications enable row level security;
alter table public.nev_audit_events enable row level security;

create policy nev_customers_staff on public.nev_customers for all to authenticated
using (nev_private.nev_is_active_staff()) with check (nev_private.nev_is_active_staff());
create policy nev_approvals_staff on public.nev_case_approvals for select to authenticated using (nev_private.nev_is_active_staff());
create policy nev_attachments_staff on public.nev_case_attachments for all to authenticated
using (nev_private.nev_is_active_staff()) with check (nev_private.nev_is_active_staff());
create policy nev_resolutions_staff on public.nev_case_resolutions for select to authenticated using (nev_private.nev_is_active_staff());
create policy nev_refund_payments_staff on public.nev_refund_payments for select to authenticated using (nev_private.nev_is_active_staff());
create policy nev_tasks_staff on public.nev_tasks for all to authenticated
using (nev_private.nev_is_active_staff()) with check (nev_private.nev_is_active_staff());
create policy nev_task_updates_staff on public.nev_task_updates for all to authenticated
using (nev_private.nev_is_active_staff()) with check (nev_private.nev_is_active_staff());
create policy nev_notifications_own on public.nev_notifications for select to authenticated
using (recipient_id = (select auth.uid()));
create policy nev_notifications_own_update on public.nev_notifications for update to authenticated
using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy nev_audit_super_admin on public.nev_audit_events for select to authenticated
using (nev_private.nev_is_super_admin());

create policy nev_case_files_select on storage.objects for select to authenticated
using (bucket_id = 'nev-case-files' and nev_private.nev_is_active_staff());
create policy nev_case_files_insert on storage.objects for insert to authenticated
with check (bucket_id = 'nev-case-files' and nev_private.nev_is_active_staff());
create policy nev_case_files_update on storage.objects for update to authenticated
using (bucket_id = 'nev-case-files' and nev_private.nev_is_active_staff())
with check (bucket_id = 'nev-case-files' and nev_private.nev_is_active_staff());
create policy nev_case_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'nev-case-files' and nev_private.nev_is_active_staff());

revoke all on public.nev_customers, public.nev_case_approvals, public.nev_case_attachments,
  public.nev_case_resolutions, public.nev_refund_payments, public.nev_tasks,
  public.nev_task_updates, public.nev_notifications, public.nev_audit_events
from public, anon, authenticated;
grant select, insert, update on public.nev_customers to authenticated;
grant select on public.nev_case_approvals, public.nev_case_resolutions, public.nev_refund_payments, public.nev_audit_events to authenticated;
grant select, insert, delete on public.nev_case_attachments to authenticated;
grant select, insert, update on public.nev_tasks, public.nev_task_updates to authenticated;
grant select, update on public.nev_notifications to authenticated;

revoke all on function public.nev_create_case(text,text,numeric,text,text,text,uuid) from public;
revoke all on function public.nev_request_case_review(uuid,uuid,text) from public;
revoke all on function public.nev_decide_case_review(uuid,boolean,text) from public;
revoke all on function public.nev_begin_renegotiation(uuid,text) from public;
revoke all on function public.nev_record_installment_payment(uuid,numeric,text,date,text) from public;
revoke all on function public.nev_task_send_question(uuid,text) from public;
revoke all on function public.nev_create_task(text,text,text,uuid,timestamptz) from public;
revoke all on function public.nev_task_answer(uuid,text) from public;
revoke all on function public.nev_task_snooze(uuid,timestamptz,text) from public;
revoke all on function public.nev_task_complete(uuid) from public;
revoke all on function public.nev_log_access(text) from public;
grant execute on function public.nev_create_case(text,text,numeric,text,text,text,uuid) to authenticated;
grant execute on function public.nev_request_case_review(uuid,uuid,text) to authenticated;
grant execute on function public.nev_decide_case_review(uuid,boolean,text) to authenticated;
grant execute on function public.nev_begin_renegotiation(uuid,text) to authenticated;
grant execute on function public.nev_record_installment_payment(uuid,numeric,text,date,text) to authenticated;
grant execute on function public.nev_task_send_question(uuid,text) to authenticated;
grant execute on function public.nev_create_task(text,text,text,uuid,timestamptz) to authenticated;
grant execute on function public.nev_task_answer(uuid,text) to authenticated;
grant execute on function public.nev_task_snooze(uuid,timestamptz,text) to authenticated;
grant execute on function public.nev_task_complete(uuid) to authenticated;
grant execute on function public.nev_log_access(text) to authenticated;

do $$
declare v_table text;
begin
  foreach v_table in array array['nev_cases','nev_case_updates','nev_case_approvals','nev_case_attachments','nev_tasks','nev_task_updates','nev_notifications','nev_refund_installments'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;

comment on table public.nev_customers is 'NEV: clientes únicos por WhatsApp';
comment on table public.nev_case_attachments is 'NEV: comprovantes e imagens privadas dos atendimentos';
comment on table public.nev_tasks is 'NEV: tarefas internas com responsável, prazo e espera';
comment on table public.nev_audit_events is 'NEV: auditoria exclusiva do administrador geral Clovis';
