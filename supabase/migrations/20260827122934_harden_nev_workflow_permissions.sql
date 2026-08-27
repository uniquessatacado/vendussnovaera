-- Bloqueia explicitamente chamadas anônimas nas RPCs do Nova Era.
revoke execute on function public.nev_claim_access(text) from anon;
revoke execute on function public.nev_admin_set_profile(uuid,boolean,text) from anon;
revoke execute on function public.nev_apply_resolution(uuid,text,numeric,text,integer,date) from anon;
revoke execute on function public.nev_mark_installment_paid(uuid,boolean,text) from anon;
revoke execute on function public.nev_create_case(text,text,numeric,text,text,text,uuid) from anon;
revoke execute on function public.nev_request_case_review(uuid,uuid,text) from anon;
revoke execute on function public.nev_decide_case_review(uuid,boolean,text) from anon;
revoke execute on function public.nev_begin_renegotiation(uuid,text) from anon;
revoke execute on function public.nev_record_installment_payment(uuid,numeric,text,date,text) from anon;
revoke execute on function public.nev_create_task(text,text,text,uuid,timestamptz) from anon;
revoke execute on function public.nev_task_send_question(uuid,text) from anon;
revoke execute on function public.nev_task_answer(uuid,text) from anon;
revoke execute on function public.nev_task_snooze(uuid,timestamptz,text) from anon;
revoke execute on function public.nev_task_complete(uuid) from anon;
revoke execute on function public.nev_log_access(text) from anon;

create index if not exists nev_cases_customer_id_idx on public.nev_cases(customer_id);
create index if not exists nev_cases_review_requested_to_idx on public.nev_cases(review_requested_to);
create index if not exists nev_cases_review_decided_by_idx on public.nev_cases(review_decided_by);
create index if not exists nev_case_updates_recipient_idx on public.nev_case_updates(recipient_id);
create index if not exists nev_case_resolutions_created_by_idx on public.nev_case_resolutions(created_by);
create index if not exists nev_tasks_assigned_to_idx on public.nev_tasks(assigned_to);
create index if not exists nev_tasks_created_by_idx on public.nev_tasks(created_by);
create index if not exists nev_task_updates_author_idx on public.nev_task_updates(author_id);
create index if not exists nev_task_updates_recipient_idx on public.nev_task_updates(recipient_id);
create index if not exists nev_notifications_actor_idx on public.nev_notifications(actor_id);
create index if not exists nev_refund_payments_paid_by_idx on public.nev_refund_payments(paid_by);
create index if not exists nev_refund_plans_resolution_idx on public.nev_refund_plans(resolution_id);
