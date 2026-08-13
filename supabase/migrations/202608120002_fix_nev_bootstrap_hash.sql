create or replace function public.nev_claim_access(p_bootstrap_token text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_full_name text;
  v_has_profiles boolean;
  v_expected_hash text;
begin
  if v_user_id is null then
    raise exception 'É necessário entrar na conta.';
  end if;

  if exists (select 1 from public.nev_profiles where user_id = v_user_id) then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('nova-era-venduss-bootstrap', 0));

  if exists (select 1 from public.nev_profiles where user_id = v_user_id) then
    return;
  end if;

  select
    u.email,
    nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), '')
  into v_email, v_full_name
  from auth.users u
  where u.id = v_user_id;

  if v_email is null then
    raise exception 'Não foi possível identificar o e-mail da conta.';
  end if;

  select exists (select 1 from public.nev_profiles) into v_has_profiles;

  if not v_has_profiles then
    select token_hash
    into v_expected_hash
    from nev_private.nev_bootstrap_config
    where singleton = true and used_at is null
    for update;

    if v_expected_hash is null
      or p_bootstrap_token is null
      or pg_catalog.encode(extensions.digest(p_bootstrap_token, 'sha256'), 'hex') <> v_expected_hash then
      raise exception 'Chave inicial inválida.';
    end if;

    insert into public.nev_profiles (user_id, email, full_name, role, active)
    values (v_user_id, lower(v_email), v_full_name, 'admin', true);

    update nev_private.nev_bootstrap_config
    set used_at = now(), used_by = v_user_id
    where singleton = true;
  else
    insert into public.nev_profiles (user_id, email, full_name, role, active)
    values (v_user_id, lower(v_email), v_full_name, 'agent', false);
  end if;
end;
$$;

revoke all on function public.nev_claim_access(text) from public;
grant execute on function public.nev_claim_access(text) to authenticated;
