CREATE FUNCTION hex_validate_role_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM roles r JOIN auth_users u ON u.id=NEW.user_id WHERE r.id=NEW.role_id AND (r.system OR r.organization_id=u.organization_id)) THEN
  RAISE EXCEPTION 'Role belongs to another organization' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER role_assignment_integrity BEFORE INSERT OR UPDATE ON user_roles FOR EACH ROW EXECUTE FUNCTION hex_validate_role_assignment();
CREATE FUNCTION hex_preserve_position_department() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.department_id IS DISTINCT FROM OLD.department_id AND EXISTS(SELECT 1 FROM employment_versions WHERE position_id=OLD.id) THEN
  RAISE EXCEPTION 'Referenced position department cannot change' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER position_department_integrity BEFORE UPDATE ON positions FOR EACH ROW EXECUTE FUNCTION hex_preserve_position_department();
