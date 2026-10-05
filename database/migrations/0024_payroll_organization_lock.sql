CREATE OR REPLACE FUNCTION hex_payroll_source_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org uuid;
BEGIN
 -- Separate statements avoid resolving organization_id on the organizations record.
 IF TG_TABLE_NAME='organizations' THEN
  IF TG_OP='DELETE' THEN org=OLD.id;ELSE org=NEW.id;END IF;
 ELSE
  IF TG_OP='DELETE' THEN org=OLD.organization_id;ELSE org=NEW.organization_id;END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text,731));
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
