create index nev_cases_created_by_idx on public.nev_cases(created_by);
create index nev_case_updates_author_id_idx on public.nev_case_updates(author_id);
create index nev_refund_plans_created_by_idx on public.nev_refund_plans(created_by);

drop policy nev_profiles_select on public.nev_profiles;
create policy nev_profiles_select
on public.nev_profiles for select
to authenticated
using (user_id = (select auth.uid()) or (select nev_private.nev_is_active_staff()));

drop policy nev_cases_select on public.nev_cases;
create policy nev_cases_select
on public.nev_cases for select
to authenticated
using ((select nev_private.nev_is_active_staff()));

drop policy nev_cases_insert on public.nev_cases;
create policy nev_cases_insert
on public.nev_cases for insert
to authenticated
with check ((select nev_private.nev_is_active_staff()) and created_by = (select auth.uid()));

drop policy nev_cases_update on public.nev_cases;
create policy nev_cases_update
on public.nev_cases for update
to authenticated
using ((select nev_private.nev_is_active_staff()))
with check ((select nev_private.nev_is_active_staff()));

drop policy nev_case_updates_select on public.nev_case_updates;
create policy nev_case_updates_select
on public.nev_case_updates for select
to authenticated
using ((select nev_private.nev_is_active_staff()));

drop policy nev_case_updates_insert on public.nev_case_updates;
create policy nev_case_updates_insert
on public.nev_case_updates for insert
to authenticated
with check ((select nev_private.nev_is_active_staff()) and author_id = (select auth.uid()));

drop policy nev_refund_plans_select on public.nev_refund_plans;
create policy nev_refund_plans_select
on public.nev_refund_plans for select
to authenticated
using ((select nev_private.nev_is_active_staff()));

drop policy nev_refund_installments_select on public.nev_refund_installments;
create policy nev_refund_installments_select
on public.nev_refund_installments for select
to authenticated
using ((select nev_private.nev_is_active_staff()));
