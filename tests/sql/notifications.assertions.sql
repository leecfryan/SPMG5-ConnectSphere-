-- SCRUM-143: run after the isolated setup and the exact documented schema.
update public.events set status = 'APPROVED' where name = 'Approved event';
update public.events set status = 'REJECTED' where name = 'Rejected event';
update public.events set status = 'UNDER_REVIEW' where name = 'Not a decision';
update public.events set status = 'APPROVED' where name = 'Approved event';
begin;
update public.events set status = 'APPROVED' where name = 'Rollback event';
rollback;
do $$
declare rows_count integer; first_claim public.notification_outbox; next_claim public.notification_outbox;
begin
  select count(*) into rows_count from public.notification_outbox;
  if rows_count <> 2 then raise exception '[TC-SCRUM-143-29] expected exactly two decisions'; end if;
  if not exists(select 1 from public.notification_outbox where recipient_id = '11111111-1111-4111-8111-111111111111' and payload = '{"eventId":"aaaaaaaa-0002-4000-8000-000000000000","eventName":"Rejected event","outcome":"rejected","remark":"Missing details"}') then
    raise exception '[TC-SCRUM-143-29] wrong recipient or payload';
  end if;
  if not exists(select 1 from public.events where name = 'Rollback event' and status = 'UNDER_REVIEW') then raise exception '[TC-SCRUM-143-29] rollback lost'; end if;
  -- SCRUM-143: queue insert failure must also roll back the event decision.
  begin
    update public.events set organiser_id = '99999999-9999-4999-8999-999999999999', status = 'APPROVED' where name = 'Rollback event';
    raise exception '[TC-SCRUM-143-29] failed enqueue accepted decision';
  exception when foreign_key_violation then null;
  end;
  if not exists(select 1 from public.events where name = 'Rollback event' and status = 'UNDER_REVIEW') then raise exception '[TC-SCRUM-143-29] atomicity lost'; end if;
  select * into first_claim from public.claim_notification_outbox() limit 1;
  select count(*) into rows_count from public.claim_notification_outbox();
  if rows_count <> 0 then raise exception '[TC-SCRUM-143-30] active lease claimed twice'; end if;
  if public.finish_notification_outbox(first_claim.id, gen_random_uuid(), true) then raise exception '[TC-SCRUM-143-30] forged lease acknowledged'; end if;
  update public.notification_outbox set locked_until = now() - interval '1 second';
  select * into next_claim from public.claim_notification_outbox() where id = first_claim.id;
  if next_claim.lease_token = first_claim.lease_token or next_claim.attempts <> 2 then raise exception '[TC-SCRUM-143-30] expired lease did not recover'; end if;
  if public.finish_notification_outbox(first_claim.id, first_claim.lease_token, true) then raise exception '[TC-SCRUM-143-30] stale worker deleted new claim'; end if;
  if not public.finish_notification_outbox(next_claim.id, next_claim.lease_token, false) then raise exception '[TC-SCRUM-143-30] retry failed'; end if;
  if not exists(select 1 from public.notification_outbox where id = next_claim.id and next_attempt_at = now() + interval '30 seconds' and locked_until is null and lease_token is null) then raise exception '[TC-SCRUM-143-30] incorrect retry delay'; end if;
  update public.notification_outbox set next_attempt_at = now(), attempts = 100, locked_until = null;
  select * into next_claim from public.claim_notification_outbox() where id = first_claim.id;
  perform public.finish_notification_outbox(next_claim.id, next_claim.lease_token, false);
  if not exists(select 1 from public.notification_outbox where id = next_claim.id and next_attempt_at = now() + interval '1 hour') then raise exception '[TC-SCRUM-143-30] retry cap exceeded'; end if;
  update public.notification_outbox set next_attempt_at = now(), locked_until = null;
  select * into next_claim from public.claim_notification_outbox() where id = first_claim.id;
  if not public.finish_notification_outbox(next_claim.id, next_claim.lease_token, true) then raise exception '[TC-SCRUM-143-30] accepted delivery not deleted'; end if;
  if exists(select 1 from public.notification_outbox where id = next_claim.id) then raise exception '[TC-SCRUM-143-30] delivered history retained locally'; end if;
end;
$$;
set role anon;
do $$ begin
  begin perform * from public.notification_outbox; raise exception '[TC-SCRUM-143-31] anon read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.claim_notification_outbox(); raise exception '[TC-SCRUM-143-31] anon claim allowed'; exception when insufficient_privilege then null; end;
  begin perform public.finish_notification_outbox(gen_random_uuid(), gen_random_uuid(), true); raise exception '[TC-SCRUM-143-31] anon finish allowed'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
set role authenticated;
do $$ begin
  begin perform * from public.notification_outbox; raise exception '[TC-SCRUM-143-31] authenticated read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.claim_notification_outbox(); raise exception '[TC-SCRUM-143-31] authenticated claim allowed'; exception when insufficient_privilege then null; end;
  begin perform public.finish_notification_outbox(gen_random_uuid(), gen_random_uuid(), true); raise exception '[TC-SCRUM-143-31] authenticated finish allowed'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
set role service_role;
select count(*) from public.notification_outbox;
select count(*) from public.claim_notification_outbox();
reset role;
select 'SQL NOTIFICATION ASSERTIONS PASSED' as evidence;
