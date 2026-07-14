from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

SCHEMA_VERSION = 1

SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS engine_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT
);

CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT,
    source TEXT DEFAULT 'google_keywords',
    face_cluster_id INTEGER,
    confirmed INTEGER DEFAULT 1,
    photo_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rel_path TEXT NOT NULL UNIQUE,
    abs_path TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    media_type TEXT NOT NULL,
    taken_at TEXT,
    year INTEGER,
    album TEXT,
    keywords TEXT,
    description TEXT,
    user_comment TEXT,
    latitude REAL,
    longitude REAL,
    width INTEGER,
    height INTEGER,
    duration_sec REAL,
    phash TEXT,
    scene_tags TEXT,
    wardrobe_tags TEXT,
    file_size INTEGER,
    indexed_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS media_people (
    media_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    source TEXT DEFAULT 'keywords',
    PRIMARY KEY (media_id, person_id),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS face_clusters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER,
    face_count INTEGER DEFAULT 0,
    confirmed INTEGER DEFAULT 0,
    label TEXT,
    FOREIGN KEY (person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS faces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    cluster_id INTEGER,
    person_id INTEGER,
    bbox_x REAL,
    bbox_y REAL,
    bbox_w REAL,
    bbox_h REAL,
    embedding BLOB,
    confidence REAL,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
    FOREIGN KEY (cluster_id) REFERENCES face_clusters(id),
    FOREIGN KEY (person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    cluster_id INTEGER,
    geocode_name TEXT,
    media_count INTEGER DEFAULT 0,
    is_home INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS media_places (
    media_id INTEGER NOT NULL,
    place_id INTEGER NOT NULL,
    PRIMARY KEY (media_id, place_id),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
    FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    place_id INTEGER,
    start_at TEXT,
    end_at TEXT,
    media_count INTEGER DEFAULT 0,
    FOREIGN KEY (place_id) REFERENCES places(id)
);

CREATE TABLE IF NOT EXISTS media_trips (
    media_id INTEGER NOT NULL,
    trip_id INTEGER NOT NULL,
    PRIMARY KEY (media_id, trip_id),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
    FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    start_at TEXT,
    end_at TEXT,
    summary TEXT,
    media_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS media_events (
    media_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    PRIMARY KEY (media_id, event_id),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS duplicate_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    representative_media_id INTEGER,
    member_count INTEGER DEFAULT 0,
    FOREIGN KEY (representative_media_id) REFERENCES media(id)
);

CREATE TABLE IF NOT EXISTS media_duplicates (
    media_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    similarity REAL,
    PRIMARY KEY (media_id, group_id),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES duplicate_groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS embeddings (
    media_id INTEGER PRIMARY KEY,
    model_name TEXT NOT NULL,
    faiss_id INTEGER NOT NULL,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transcripts (
    media_id INTEGER PRIMARY KEY,
    text TEXT,
    segments TEXT,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS processing_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    total INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    error TEXT,
    started_at TEXT,
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS geocode_cache (
    lat_key TEXT NOT NULL,
    lon_key TEXT NOT NULL,
    display_name TEXT,
    raw_json TEXT,
    PRIMARY KEY (lat_key, lon_key)
);

CREATE INDEX IF NOT EXISTS idx_media_year ON media(year);
CREATE INDEX IF NOT EXISTS idx_media_taken ON media(taken_at);
CREATE INDEX IF NOT EXISTS idx_media_type ON media(media_type);
CREATE INDEX IF NOT EXISTS idx_media_hash ON media(file_hash);
CREATE INDEX IF NOT EXISTS idx_faces_media ON faces(media_id);
CREATE INDEX IF NOT EXISTS idx_faces_cluster ON faces(cluster_id);
CREATE INDEX IF NOT EXISTS idx_media_geo ON media(latitude, longitude);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=60)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def init_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(SCHEMA_SQL)
            row = conn.execute("SELECT version FROM schema_version LIMIT 1").fetchone()
            if row is None:
                conn.execute("INSERT INTO schema_version(version) VALUES (?)", (SCHEMA_VERSION,))
            self._ensure_fts(conn)

    def _ensure_fts(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
                text,
                content='transcripts',
                content_rowid='media_id'
            )
            """
        )
        conn.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
                rel_path,
                keywords,
                description,
                scene_tags,
                wardrobe_tags,
                content='media',
                content_rowid='id'
            )
            """
        )

    def rebuild_fts(self) -> None:
        with self.connect() as conn:
            for table in ("transcripts_fts", "media_fts"):
                try:
                    conn.execute(f"INSERT INTO {table}({table}) VALUES('rebuild')")
                except sqlite3.OperationalError:
                    pass

    def get_state(self, key: str, default: str | None = None) -> str | None:
        with self.connect() as conn:
            row = conn.execute("SELECT value FROM engine_state WHERE key = ?", (key,)).fetchone()
            return row["value"] if row else default

    def set_state(self, key: str, value: str) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO engine_state(key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )

    def stats(self) -> dict[str, Any]:
        with self.connect() as conn:
            counts = {}
            for table in (
                "media",
                "people",
                "faces",
                "places",
                "trips",
                "events",
                "duplicate_groups",
                "embeddings",
                "transcripts",
            ):
                counts[table] = conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()["c"]
            images = conn.execute(
                "SELECT COUNT(*) AS c FROM media WHERE media_type = 'image'"
            ).fetchone()["c"]
            videos = conn.execute(
                "SELECT COUNT(*) AS c FROM media WHERE media_type = 'video'"
            ).fetchone()["c"]
            gps = conn.execute(
                "SELECT COUNT(*) AS c FROM media WHERE latitude IS NOT NULL"
            ).fetchone()["c"]
            return {**counts, "images": images, "videos": videos, "gps_photos": gps}

    def row_to_dict(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        return dict(row)

    def json_loads(self, text: str | None) -> Any:
        if not text:
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text
