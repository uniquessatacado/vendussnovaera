create table public.nev_order_systems (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  base_url text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.nev_order_systems(label, base_url, sort_order)
values
  ('Antigo — Fornecedoruss', 'https://fornecedoruss.com.br', 10),
  ('Novo — Venduss', 'https://venduss.com/loja/venduss', 20),
  ('Novo — Taivend', 'https://taivend.venduss.com', 30),
  ('Zero19', 'https://lojazero19.com', 40)
on conflict (label) do update set base_url = excluded.base_url, sort_order = excluded.sort_order, active = true;

create table public.nev_case_orders (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.nev_cases(id) on delete cascade,
  system_id uuid references public.nev_order_systems(id) on delete set null,
  system_label text not null,
  order_number text not null check (char_length(btrim(order_number)) between 1 and 80),
  order_date date not null,
  amount numeric(12,2) not null check (amount >= 0),
  created_by uuid references public.nev_profiles(user_id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

insert into public.nev_case_orders(case_id, system_label, order_number, order_date, amount, created_by, created_at)
select id, 'Não informado', case_number::text, created_at::date, order_value, created_by, created_at
from public.nev_cases c
where not exists (select 1 from public.nev_case_orders o where o.case_id = c.id);

create index nev_case_orders_case_idx on public.nev_case_orders(case_id, order_date desc);
create index nev_case_orders_system_idx on public.nev_case_orders(system_id);
create index nev_case_orders_created_by_idx on public.nev_case_orders(created_by);

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

alter table public.nev_order_systems enable row level security;
alter table public.nev_case_orders enable row level security;
create policy nev_order_systems_staff on public.nev_order_systems for select to authenticated
using (nev_private.nev_is_active_staff());
create policy nev_case_orders_staff on public.nev_case_orders for select to authenticated
using (nev_private.nev_is_active_staff());

revoke all on public.nev_order_systems, public.nev_case_orders from public, anon, authenticated;
grant select on public.nev_order_systems, public.nev_case_orders to authenticated;
revoke execute on function public.nev_create_case_with_orders(text,text,text,text,text,uuid,jsonb) from public, anon;
grant execute on function public.nev_create_case_with_orders(text,text,text,text,text,uuid,jsonb) to authenticated;

drop trigger if exists nev_case_orders_audit on public.nev_case_orders;
create trigger nev_case_orders_audit after insert or update or delete on public.nev_case_orders
for each row execute function nev_private.nev_audit_change();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='nev_case_orders') then
    alter publication supabase_realtime add table public.nev_case_orders;
  end if;
end $$;

comment on table public.nev_order_systems is 'NEV: sistemas de origem dos pedidos';
comment on table public.nev_case_orders is 'NEV: um ou mais pedidos vinculados ao atendimento';
