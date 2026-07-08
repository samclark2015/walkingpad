CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  INTEGER NOT NULL,
    duration_s  INTEGER NOT NULL,
    dist_m      INTEGER NOT NULL,
    steps       INTEGER NOT NULL,
    max_speed   REAL    NOT NULL,
    avg_speed   REAL    NOT NULL,
    created_at  INTEGER DEFAULT (unixepoch())
);
