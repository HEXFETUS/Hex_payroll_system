import pg from 'pg';
// Calendar dates must never be converted through the workstation timezone.
pg.types.setTypeParser(1082, (value) => value);
