CREATE TABLE auth_users (
 id uuid PRIMARY KEY,
 username varchar(64) NOT NULL CHECK (username ~ '^[A-Za-z0-9._-]{3,64}$'),
 email varchar(254),
 display_name varchar(128) NOT NULL CHECK (length(btrim(display_name)) > 0),
 password_hash text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX auth_users_username_unique ON auth_users (lower(username));
CREATE UNIQUE INDEX auth_users_email_unique ON auth_users (lower(email)) WHERE email IS NOT NULL;
CREATE TABLE auth_sessions (
 token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions(expires_at);
