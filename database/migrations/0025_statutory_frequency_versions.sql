-- Independent verified tables may coexist for different payroll frequencies.
CREATE OR REPLACE FUNCTION hex_payroll_reference_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(NEW.organization_id,OLD.organization_id)::text,731));
 IF TG_TABLE_NAME='payroll_policies' THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Payroll policy versions are immutable' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM payroll_policies p WHERE p.organization_id=NEW.organization_id AND daterange(p.effective_from,p.effective_to,'[)') && daterange(NEW.effective_from,NEW.effective_to,'[)')) THEN RAISE EXCEPTION 'Payroll policy versions overlap' USING ERRCODE='23514';END IF;
 ELSE
  IF TG_OP<>'INSERT' AND OLD.status='active' THEN RAISE EXCEPTION 'Active statutory versions are immutable' USING ERRCODE='23514';END IF;
  IF NEW.status='active' AND EXISTS(SELECT 1 FROM statutory_rule_sets s WHERE s.organization_id=NEW.organization_id AND s.type=NEW.type AND s.rules->>'frequency'=NEW.rules->>'frequency' AND s.id<>NEW.id AND s.status='active' AND daterange(s.effective_from,s.effective_to,'[)') && daterange(NEW.effective_from,NEW.effective_to,'[)')) THEN RAISE EXCEPTION 'Active statutory versions overlap' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
