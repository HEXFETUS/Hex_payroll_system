-- Phase 4 synchronization transport. Local outbox events are accepted by the
-- central service once, then exposed as an ordered change stream to other nodes.

ALTER TABLE sync_nodes
  ADD COLUMN token_hash char(64),
  ADD COLUMN enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN last_pull_sequence bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT sync_nodes_token_hash_check
    CHECK(token_hash IS NULL OR token_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT sync_nodes_pull_sequence_check
    CHECK(last_pull_sequence>=0),
  ADD CONSTRAINT sync_nodes_revocation_check
    CHECK((enabled AND revoked_at IS NULL) OR (NOT enabled));

CREATE UNIQUE INDEX sync_nodes_token_hash_idx
  ON sync_nodes(token_hash)
  WHERE token_hash IS NOT NULL;

CREATE TABLE sync_changes (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT uuidv7() UNIQUE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  source_node_id uuid NOT NULL REFERENCES sync_nodes(id),
  source_event_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  operation text NOT NULL CHECK(operation IN ('CREATE','UPDATE','ARCHIVE')),
  revision integer NOT NULL CHECK(revision>0),
  payload_version integer NOT NULL DEFAULT 1 CHECK(payload_version>0),
  payload jsonb NOT NULL CHECK(
    jsonb_typeof(payload)='object'
    AND octet_length(payload::text)<=262144
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_node_id,source_event_id)
);

CREATE INDEX sync_changes_pull_idx
  ON sync_changes(organization_id,sequence);

CREATE TABLE sync_conflicts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  node_id uuid NOT NULL REFERENCES sync_nodes(id),
  source_event_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  incoming_revision integer NOT NULL CHECK(incoming_revision>0),
  current_revision integer CHECK(current_revision IS NULL OR current_revision>0),
  incoming_payload jsonb NOT NULL CHECK(jsonb_typeof(incoming_payload)='object'),
  current_payload jsonb CHECK(current_payload IS NULL OR jsonb_typeof(current_payload)='object'),
  reason text NOT NULL CHECK(length(btrim(reason))>0),
  status text NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','resolved','ignored')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth_users(id),
  UNIQUE(node_id,source_event_id),
  CHECK(
    (status='open' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR
    (status IN ('resolved','ignored') AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX sync_conflicts_open_idx
  ON sync_conflicts(organization_id,status,created_at);
