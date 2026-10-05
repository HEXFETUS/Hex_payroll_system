-- Rule/policy contents remain immutable. Explicit new versions may shorten an
-- earlier applicability window only when finalized history is unaffected.
CREATE OR REPLACE FUNCTION hex_payroll_reference_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(NEW.organization_id,OLD.organization_id)::text,731));
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payroll reference versions cannot be deleted' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='payroll_policies' THEN
  IF TG_OP='UPDATE' THEN
   IF (to_jsonb(NEW)-ARRAY['effective_to','revision']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['effective_to','revision']) OR NEW.effective_to IS NULL OR NEW.effective_to<=OLD.effective_from OR (OLD.effective_to IS NOT NULL AND NEW.effective_to>=OLD.effective_to) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Payroll policy versions are immutable' USING ERRCODE='23514';END IF;
   IF EXISTS(SELECT 1 FROM payroll_runs r JOIN payroll_periods p ON p.id=r.period_id WHERE r.organization_id=OLD.organization_id AND r.finalized AND p.period_end>=NEW.effective_to AND r.snapshot->'policies' @> jsonb_build_array(jsonb_build_object('id',OLD.id))) THEN RAISE EXCEPTION 'Supersession would alter finalized payroll applicability' USING ERRCODE='23514';END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM payroll_policies p WHERE p.organization_id=NEW.organization_id AND p.id<>NEW.id AND daterange(p.effective_from,p.effective_to,'[)') && daterange(NEW.effective_from,NEW.effective_to,'[)')) THEN RAISE EXCEPTION 'Payroll policy versions overlap' USING ERRCODE='23514';END IF;
 ELSE
  IF TG_OP='UPDATE' AND OLD.status='active' THEN
   IF (to_jsonb(NEW)-ARRAY['effective_to','revision']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['effective_to','revision']) OR NEW.effective_to IS NULL OR NEW.effective_to<=OLD.effective_from OR (OLD.effective_to IS NOT NULL AND NEW.effective_to>=OLD.effective_to) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Active statutory versions are immutable' USING ERRCODE='23514';END IF;
   IF EXISTS(SELECT 1 FROM employee_payroll_results e JOIN payroll_runs r ON r.id=e.payroll_run_id JOIN payroll_periods p ON p.id=r.period_id WHERE e.organization_id=OLD.organization_id AND r.finalized AND (CASE WHEN OLD.rules->>'effectiveDateBasis'='pay_date' THEN p.pay_date ELSE p.period_end END)>=NEW.effective_to AND ((OLD.type='bir' AND e.tax_trace->>'ruleSetId'=OLD.id::text) OR EXISTS(SELECT 1 FROM payroll_contribution_lines l WHERE l.result_id=e.id AND l.rule_set_id=OLD.id))) THEN RAISE EXCEPTION 'Supersession would alter finalized payroll applicability' USING ERRCODE='23514';END IF;
  END IF;
  IF NEW.status='active' AND EXISTS(SELECT 1 FROM statutory_rule_sets s WHERE s.organization_id=NEW.organization_id AND s.type=NEW.type AND s.rules->>'frequency'=NEW.rules->>'frequency' AND s.id<>NEW.id AND s.status='active' AND daterange(s.effective_from,s.effective_to,'[)') && daterange(NEW.effective_from,NEW.effective_to,'[)')) THEN RAISE EXCEPTION 'Active statutory versions overlap' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
