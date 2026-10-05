-- Serialize immutability checks before reading parent status.
CREATE OR REPLACE FUNCTION hex_payroll_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen boolean; target uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(NEW.organization_id,OLD.organization_id)::text,731));
 IF TG_TABLE_NAME='payroll_periods' THEN frozen=OLD.status='finalized';
 ELSIF TG_TABLE_NAME='payroll_runs' THEN
  IF TG_OP='INSERT' THEN target=NEW.period_id;ELSE target=OLD.period_id;END IF;
  SELECT status='finalized' INTO frozen FROM payroll_periods WHERE id=target;
  IF TG_OP<>'INSERT' THEN
   frozen=COALESCE(frozen,false) OR OLD.finalized;
   IF TG_OP='UPDATE' AND OLD.status<>'processing' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.totals IS DISTINCT FROM OLD.totals OR NEW.issues IS DISTINCT FROM OLD.issues OR NEW.input_hash IS DISTINCT FROM OLD.input_hash OR NEW.period_id IS DISTINCT FROM OLD.period_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.prepared_by IS DISTINCT FROM OLD.prepared_by OR NEW.engine_version IS DISTINCT FROM OLD.engine_version OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key) THEN RAISE EXCEPTION 'Completed payroll runs are immutable' USING ERRCODE='23514';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='employee_payroll_results' THEN
  IF TG_OP='INSERT' THEN target=NEW.payroll_run_id;ELSE target=OLD.payroll_run_id;END IF;
  SELECT r.finalized OR p.status='finalized' INTO frozen FROM payroll_runs r JOIN payroll_periods p ON p.id=r.period_id WHERE r.id=target;
 ELSE
  IF TG_OP='INSERT' THEN target=NEW.result_id;ELSE target=OLD.result_id;END IF;
  SELECT r.finalized OR p.status='finalized' INTO frozen FROM payroll_runs r JOIN payroll_periods p ON p.id=r.period_id JOIN employee_payroll_results e ON e.payroll_run_id=r.id WHERE e.id=target;
 END IF;
 IF frozen THEN RAISE EXCEPTION 'Finalized payroll is immutable' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME NOT IN ('payroll_periods','payroll_runs') THEN RAISE EXCEPTION 'Historical payroll results are append-only' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
CREATE OR REPLACE FUNCTION hex_payroll_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(NEW.organization_id,OLD.organization_id)::text,731));
 IF TG_OP='INSERT' THEN target=NEW.period_id;ELSE target=OLD.period_id;END IF;
 IF EXISTS(SELECT 1 FROM payroll_periods WHERE id=target AND status IN ('finalized','cancelled')) OR (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM payroll_periods WHERE id=NEW.period_id AND status IN ('finalized','cancelled'))) THEN RAISE EXCEPTION 'Closed payroll entries cannot be changed' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
