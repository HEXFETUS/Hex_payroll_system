-- Transport receipts are distinct from business-table application. A durable
-- local inbox holds pulled events until a future business receiver applies them.
ALTER TABLE sync_nodes ADD CONSTRAINT sync_nodes_organization_identity UNIQUE(organization_id,id);
ALTER TABLE sync_changes ADD CONSTRAINT sync_changes_node_scope FOREIGN KEY(organization_id,source_node_id) REFERENCES sync_nodes(organization_id,id);
ALTER TABLE sync_conflicts ADD CONSTRAINT sync_conflicts_node_scope FOREIGN KEY(organization_id,node_id) REFERENCES sync_nodes(organization_id,id);

-- Allocate the published sequence under a transaction lock. Identity defaults
-- alone do not order commits; gaps are harmless, late lower sequences are not.
CREATE FUNCTION hex_sync_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(684297104);
 NEW.sequence:=nextval(pg_get_serial_sequence(format('%I.sync_changes',TG_TABLE_SCHEMA),'sequence'));
 RETURN NEW;
END $$;
CREATE TRIGGER sync_changes_sequence BEFORE INSERT ON sync_changes FOR EACH ROW EXECUTE FUNCTION hex_sync_sequence();
REVOKE UPDATE,DELETE,TRUNCATE ON sync_changes FROM hexpayroll_app;
GRANT USAGE,SELECT ON SEQUENCE sync_changes_sequence_seq TO hexpayroll_app;

ALTER TABLE sync_outbox
 ADD COLUMN lease_token uuid,
 ADD COLUMN lease_expires_at timestamptz,
 ADD COLUMN next_attempt_at timestamptz,
 ADD COLUMN central_sequence bigint CHECK(central_sequence IS NULL OR central_sequence>0),
 ADD COLUMN synced_at timestamptz;
CREATE INDEX sync_outbox_delivery_idx ON sync_outbox(organization_id,status,next_attempt_at,created_at,id);

CREATE TABLE sync_inbox (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 sequence bigint NOT NULL CHECK(sequence>0),
 change_id uuid NOT NULL,
 source_node_id uuid NOT NULL,
 source_event_id uuid NOT NULL,
 entity_type text NOT NULL CHECK(length(btrim(entity_type))>0),
 entity_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('CREATE','UPDATE','ARCHIVE')),
 revision integer NOT NULL CHECK(revision>0),
 payload_version integer NOT NULL CHECK(payload_version>0),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=262144),
 received_at timestamptz NOT NULL DEFAULT now(),
 applied_at timestamptz,
 PRIMARY KEY(organization_id,sequence),
 UNIQUE(organization_id,change_id),
 UNIQUE(organization_id,source_node_id,source_event_id)
);
GRANT SELECT,INSERT,UPDATE ON sync_inbox TO hexpayroll_app;
