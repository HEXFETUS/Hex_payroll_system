-- Source writes take the same exclusive organization lock as payroll transitions.
-- Taking it in database triggers also covers worker/CLI/direct SQL writes.
CREATE FUNCTION hex_payroll_source_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org uuid;
BEGIN
 org=CASE WHEN TG_TABLE_NAME='organizations' THEN COALESCE(NEW.id,OLD.id) ELSE COALESCE(NEW.organization_id,OLD.organization_id) END;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text,731));
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['organizations','employees','employment_versions','departments','positions','payroll_configurations','attendance_records','attendance_processing_jobs','employee_schedule_assignments','work_schedule_versions','work_schedule_days','leave_requests','leave_types','payroll_periods','payroll_runs','employee_payroll_results','payroll_types','payroll_entries','payroll_policies','statutory_rule_sets'] LOOP
  EXECUTE format('CREATE TRIGGER payroll_source_lock BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION hex_payroll_source_lock()',t);
 END LOOP;
END $$;
CREATE FUNCTION hex_payroll_period_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.status IN ('finalized','cancelled') THEN RAISE EXCEPTION 'Closed payroll cannot be modified' USING ERRCODE='23514'; END IF;
 IF NEW.status<>'cancelled' AND EXISTS(SELECT 1 FROM payroll_periods p WHERE p.organization_id=NEW.organization_id AND p.pay_frequency=NEW.pay_frequency AND p.id<>NEW.id AND p.status<>'cancelled' AND daterange(p.period_start,p.period_end,'[]') && daterange(NEW.period_start,NEW.period_end,'[]')) THEN RAISE EXCEPTION 'Payroll periods overlap' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payroll_period_integrity BEFORE INSERT OR UPDATE ON payroll_periods FOR EACH ROW EXECUTE FUNCTION hex_payroll_period_integrity();
CREATE FUNCTION hex_payroll_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen boolean; target_org uuid; target_result uuid; target_run uuid;
BEGIN
 IF TG_TABLE_NAME='payroll_periods' THEN frozen=OLD.status='finalized';
 ELSIF TG_TABLE_NAME='payroll_runs' THEN
  IF TG_OP='INSERT' THEN target_org=NEW.organization_id;target_run=NEW.period_id; ELSE target_org=OLD.organization_id;target_run=OLD.period_id; END IF;
  SELECT status='finalized' INTO frozen FROM payroll_periods WHERE id=target_run AND organization_id=target_org;
  IF TG_OP<>'INSERT' THEN frozen=COALESCE(frozen,false) OR OLD.finalized; END IF;
 ELSIF TG_TABLE_NAME='employee_payroll_results' THEN
  IF TG_OP='INSERT' THEN target_run=NEW.payroll_run_id;ELSE target_run=OLD.payroll_run_id;END IF;
  SELECT finalized INTO frozen FROM payroll_runs WHERE id=target_run;
 ELSE
  IF TG_OP='INSERT' THEN target_result=NEW.result_id;ELSE target_result=OLD.result_id;END IF;
  SELECT r.finalized INTO frozen FROM payroll_runs r JOIN employee_payroll_results e ON e.payroll_run_id=r.id WHERE e.id=target_result;
 END IF;
 IF frozen THEN RAISE EXCEPTION 'Finalized payroll is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME NOT IN ('payroll_periods','payroll_runs') THEN RAISE EXCEPTION 'Historical payroll results are append-only' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['payroll_runs','employee_payroll_results','payroll_earning_lines','payroll_deduction_lines','payroll_contribution_lines'] LOOP
  EXECUTE format('CREATE TRIGGER payroll_freeze BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION hex_payroll_freeze()',t);
  EXECUTE format('REVOKE DELETE,TRUNCATE ON %I FROM hexpayroll_app',t);
 END LOOP;
END $$;
CREATE TRIGGER payroll_period_delete_freeze BEFORE DELETE ON payroll_periods FOR EACH ROW EXECUTE FUNCTION hex_payroll_freeze();
REVOKE DELETE,TRUNCATE ON payroll_periods FROM hexpayroll_app;
CREATE FUNCTION hex_payroll_reference_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='payroll_policies' THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Payroll policy versions are immutable' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM payroll_policies p WHERE p.organization_id=NEW.organization_id AND daterange(p.effective_from,p.effective_to,'[)') && daterange(NEW.effective_from,NEW.effective_to,'[)')) THEN RAISE EXCEPTION 'Payroll policy versions overlap' USING ERRCODE='23514';END IF;
 ELSE
  IF TG_OP<>'INSERT' AND OLD.status='active' THEN RAISE EXCEPTION 'Active statutory versions are immutable' USING ERRCODE='23514';END IF;
  IF NEW.status='active' AND EXISTS(SELECT 1 FROM statutory_rule_sets s WHERE s.organization_id=NEW.organization_id AND s.type=NEW.type AND s.id<>NEW.id AND s.status='active' AND daterange(s.effective_from,s.effective_to,'[)') && daterange(NEW.effective_from,NEW.effective_to,'[)')) THEN RAISE EXCEPTION 'Active statutory versions overlap' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payroll_policy_integrity BEFORE INSERT OR UPDATE OR DELETE ON payroll_policies FOR EACH ROW EXECUTE FUNCTION hex_payroll_reference_integrity();
CREATE TRIGGER statutory_reference_integrity BEFORE INSERT OR UPDATE ON statutory_rule_sets FOR EACH ROW EXECUTE FUNCTION hex_payroll_reference_integrity();
REVOKE DELETE,TRUNCATE ON payroll_policies,statutory_rule_sets FROM hexpayroll_app;
