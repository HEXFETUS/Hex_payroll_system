-- Local publication is ordered by commit, not by UUID/timestamp allocation.
-- Historical order can only be approximated; existing receipts remain untouched.
CREATE TABLE sync_local_identity (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id),
 node_id uuid NOT NULL,
 FOREIGN KEY(organization_id,node_id) REFERENCES sync_nodes(organization_id,id)
);
GRANT SELECT,INSERT,UPDATE ON sync_local_identity TO hexpayroll_app;

CREATE FUNCTION hex_local_sync_node(org uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE node uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text,7341));
 SELECT node_id INTO node FROM sync_local_identity WHERE organization_id=org;
 IF node IS NULL THEN
  SELECT id INTO node FROM sync_nodes WHERE organization_id=org AND enabled AND revoked_at IS NULL
   ORDER BY (token_hash IS NOT NULL) DESC,created_at,id LIMIT 1;
  IF node IS NULL THEN
   INSERT INTO sync_nodes(organization_id,device_name) VALUES(org,'Unenrolled local installation') RETURNING id INTO node;
  END IF;
  INSERT INTO sync_local_identity VALUES(org,node);
 END IF;
 RETURN node;
END $$;

CREATE SEQUENCE sync_outbox_publication_seq AS bigint;
GRANT USAGE,SELECT ON SEQUENCE sync_outbox_publication_seq TO hexpayroll_app;
ALTER TABLE sync_outbox
 ADD COLUMN origin_node_id uuid,
 ADD COLUMN base_revision integer,
 ADD COLUMN publication_sequence bigint,
 ADD COLUMN retry_cycle_attempts integer NOT NULL DEFAULT 0 CHECK(retry_cycle_attempts>=0);

UPDATE sync_outbox SET origin_node_id=hex_local_sync_node(organization_id),
 base_revision=CASE WHEN operation='CREATE' THEN 0 ELSE revision-1 END,
 retry_cycle_attempts=attempt_count;
DO $$
DECLARE event record;
BEGIN
 FOR event IN SELECT id FROM sync_outbox ORDER BY created_at,id LOOP
  UPDATE sync_outbox SET publication_sequence=nextval('sync_outbox_publication_seq') WHERE id=event.id;
 END LOOP;
END $$;
ALTER TABLE sync_outbox
 ALTER COLUMN origin_node_id SET NOT NULL,
 ALTER COLUMN base_revision SET NOT NULL,
 ALTER COLUMN publication_sequence SET NOT NULL,
 ADD CONSTRAINT sync_outbox_origin_scope FOREIGN KEY(organization_id,origin_node_id) REFERENCES sync_nodes(organization_id,id),
 ADD CONSTRAINT sync_outbox_base_revision_check CHECK(base_revision>=0 AND base_revision<revision),
 ADD CONSTRAINT sync_outbox_publication_sequence_key UNIQUE(publication_sequence);
CREATE INDEX sync_outbox_unsynced_order_idx ON sync_outbox(organization_id,publication_sequence) WHERE status<>'synced';

CREATE FUNCTION hex_outbox_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- The lock is held until COMMIT/ROLLBACK, before allocating the sequence.
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text,7341));
 NEW.origin_node_id:=COALESCE(NEW.origin_node_id,hex_local_sync_node(NEW.organization_id));
 NEW.base_revision:=COALESCE(NEW.base_revision,CASE WHEN NEW.operation='CREATE' THEN 0 ELSE NEW.revision-1 END);
 NEW.publication_sequence:=nextval('sync_outbox_publication_seq');
 RETURN NEW;
END $$;
CREATE TRIGGER sync_outbox_publication BEFORE INSERT ON sync_outbox FOR EACH ROW EXECUTE FUNCTION hex_outbox_publication();
