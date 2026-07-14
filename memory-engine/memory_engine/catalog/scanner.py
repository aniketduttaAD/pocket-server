from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable

from tqdm import tqdm

from memory_engine.catalog.exif import (
    detect_album_from_path,
    dms_to_decimal,
    parse_date_from_path,
    parse_exif_datetime,
    parse_keywords,
)
from memory_engine.core.config import EngineConfig
from memory_engine.core.db import Database, utc_now

logger = logging.getLogger(__name__)

MEDIA_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif", ".mp4", ".mov", ".avi", ".mkv", ".3gpp"}
EXIFTOOL = shutil.which("exiftool")
Progress = Callable[[str, int, int, str], None]


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    """Fast content fingerprint: size + head/tail samples (sufficient for incremental ingest)."""
    stat = path.stat()
    h = hashlib.sha256()
    h.update(str(stat.st_size).encode())
    with path.open("rb") as f:
        h.update(f.read(min(chunk_size, stat.st_size)))
        if stat.st_size > chunk_size:
            f.seek(max(0, stat.st_size - chunk_size))
            h.update(f.read(chunk_size))
    return h.hexdigest()


class CatalogScanner:
    def __init__(self, config: EngineConfig, db: Database) -> None:
        self.config = config
        self.db = db
        self._people_cache: dict[str, int] = {}

    def iter_media_files(self) -> list[Path]:
        root = self.config.photos_root
        files: list[Path] = []
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if "_logs" in path.parts:
                continue
            if path.suffix.lower() in MEDIA_EXT:
                files.append(path)
        return sorted(files)

    def _batch_exif(self, files: list[Path]) -> dict[str, dict[str, Any]]:
        if not EXIFTOOL or not files:
            return {}
        # exiftool -json on huge lists can fail; chunk into batches
        result: dict[str, dict[str, Any]] = {}
        batch_size = 400
        for i in range(0, len(files), batch_size):
            batch = files[i : i + batch_size]
            proc = subprocess.run(
                [
                    EXIFTOOL,
                    "-DateTimeOriginal",
                    "-CreateDate",
                    "-Keywords",
                    "-Subject",
                    "-ImageDescription",
                    "-Description",
                    "-UserComment",
                    "-GPSLatitude",
                    "-GPSLatitudeRef",
                    "-GPSLongitude",
                    "-GPSLongitudeRef",
                    "-ImageWidth",
                    "-ImageHeight",
                    "-Duration",
                    "-json",
                    *[str(p) for p in batch],
                ],
                capture_output=True,
                text=True,
            )
            if proc.returncode != 0:
                logger.warning("exiftool batch failed: %s", proc.stderr[:200])
                continue
            for item in json.loads(proc.stdout):
                source = item.get("SourceFile")
                if source:
                    result[source] = item
        return result

    def _meta_from_exif(self, path: Path, exif: dict[str, Any] | None) -> dict[str, Any]:
        suffix = path.suffix.lower()
        media_type = "image" if suffix in {".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"} else "video"
        meta: dict[str, Any] = {
            "media_type": media_type,
            "taken_at": None,
            "year": None,
            "album": detect_album_from_path(str(path)),
            "keywords": None,
            "description": None,
            "user_comment": None,
            "latitude": None,
            "longitude": None,
            "width": None,
            "height": None,
            "duration_sec": None,
            "file_size": path.stat().st_size,
        }
        if exif:
            taken = parse_exif_datetime(exif.get("DateTimeOriginal") or exif.get("CreateDate"))
            if taken:
                meta["taken_at"] = taken.isoformat()
                meta["year"] = taken.year
            meta["keywords"] = exif.get("Keywords") or exif.get("Subject")
            meta["description"] = exif.get("ImageDescription") or exif.get("Description")
            meta["user_comment"] = exif.get("UserComment")
            meta["width"] = _as_int(exif.get("ImageWidth"))
            meta["height"] = _as_int(exif.get("ImageHeight"))
            meta["duration_sec"] = _parse_duration(exif.get("Duration"))
            lat = dms_to_decimal(str(exif.get("GPSLatitude", "")), str(exif.get("GPSLatitudeRef", "N")))
            lon = dms_to_decimal(str(exif.get("GPSLongitude", "")), str(exif.get("GPSLongitudeRef", "E")))
            if lat is not None and lon is not None and (lat or lon):
                meta["latitude"] = lat
                meta["longitude"] = lon
        if meta["year"] is None:
            for part in path.parts:
                if re.fullmatch(r"\d{4}", part):
                    meta["year"] = int(part)
                    break
        if meta["taken_at"] is None:
            taken = parse_date_from_path(path)
            if taken:
                meta["taken_at"] = taken.isoformat()
                if meta["year"] is None:
                    meta["year"] = taken.year
        return meta

    def run(self, full: bool = False, progress: Progress | None = None) -> dict[str, Any]:
        files = self.iter_media_files()
        total = len(files)
        completed = 0
        people_linked = 0

        existing: dict[str, str] = {}
        if not full:
            with self.db.connect() as conn:
                rows = conn.execute("SELECT rel_path, file_hash FROM media").fetchall()
                existing = {r["rel_path"]: r["file_hash"] for r in rows}

        exif_map = self._batch_exif(files)

        for path in tqdm(files, desc="Catalog", unit="file"):
            rel_path = str(path.relative_to(self.config.photos_root))
            if not full and rel_path in existing:
                completed += 1
                if progress:
                    progress("catalog", completed, total, rel_path)
                continue

            file_hash = sha256_file(path)

            exif = exif_map.get(str(path))
            meta = self._meta_from_exif(path, exif)
            media_id = self._upsert_media(path, rel_path, file_hash, meta)
            people_linked += self._link_people(media_id, meta.get("keywords"))
            self._ensure_album(meta.get("album"))
            completed += 1
            if progress:
                progress("catalog", completed, total, rel_path)

        self._refresh_people_counts()
        self.db.rebuild_fts()
        return {"total": total, "completed": completed, "people_links": people_linked}

    def _upsert_media(
        self,
        path: Path,
        rel_path: str,
        file_hash: str,
        meta: dict[str, Any],
    ) -> int:
        now = utc_now()
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO media (
                    rel_path, abs_path, file_hash, media_type, taken_at, year, album,
                    keywords, description, user_comment, latitude, longitude,
                    width, height, duration_sec, file_size, indexed_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(rel_path) DO UPDATE SET
                    abs_path = excluded.abs_path,
                    file_hash = excluded.file_hash,
                    media_type = excluded.media_type,
                    taken_at = excluded.taken_at,
                    year = excluded.year,
                    album = excluded.album,
                    keywords = excluded.keywords,
                    description = excluded.description,
                    user_comment = excluded.user_comment,
                    latitude = excluded.latitude,
                    longitude = excluded.longitude,
                    width = excluded.width,
                    height = excluded.height,
                    duration_sec = excluded.duration_sec,
                    file_size = excluded.file_size,
                    updated_at = excluded.updated_at
                """,
                (
                    rel_path,
                    str(path.resolve()),
                    file_hash,
                    meta.get("media_type"),
                    meta.get("taken_at"),
                    meta.get("year"),
                    meta.get("album"),
                    meta.get("keywords"),
                    meta.get("description"),
                    meta.get("user_comment"),
                    meta.get("latitude"),
                    meta.get("longitude"),
                    meta.get("width"),
                    meta.get("height"),
                    meta.get("duration_sec"),
                    meta.get("file_size"),
                    now,
                    now,
                ),
            )
            row = conn.execute("SELECT id FROM media WHERE rel_path = ?", (rel_path,)).fetchone()
            return int(row["id"])

    def _ensure_album(self, album: str | None) -> None:
        if not album:
            return
        slug = album.lower().replace(" ", "-")
        with self.db.connect() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO albums(name, slug) VALUES (?, ?)",
                (album, slug),
            )

    def _person_id(self, conn, name: str) -> int:
        if name in self._people_cache:
            return self._people_cache[name]
        row = conn.execute("SELECT id FROM people WHERE name = ?", (name,)).fetchone()
        if row:
            person_id = int(row["id"])
        else:
            cur = conn.execute(
                """
                INSERT INTO people(name, display_name, source, confirmed)
                VALUES (?, ?, 'google_keywords', 1)
                """,
                (name, name),
            )
            person_id = int(cur.lastrowid)
        self._people_cache[name] = person_id
        return person_id

    def _link_people(self, media_id: int, keywords: str | None) -> int:
        names = parse_keywords(keywords)
        linked = 0
        with self.db.connect() as conn:
            conn.execute("DELETE FROM media_people WHERE media_id = ? AND source = 'keywords'", (media_id,))
            for name in names:
                person_id = self._person_id(conn, name)
                conn.execute(
                    """
                    INSERT OR IGNORE INTO media_people(media_id, person_id, source)
                    VALUES (?, ?, 'keywords')
                    """,
                    (media_id, person_id),
                )
                linked += 1
        return linked

    def _refresh_people_counts(self) -> None:
        with self.db.connect() as conn:
            conn.execute(
                """
                UPDATE people SET photo_count = (
                    SELECT COUNT(*) FROM media_people mp WHERE mp.person_id = people.id
                )
                """
            )


def _as_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _parse_duration(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value)
    if text.endswith(" s"):
        try:
            return float(text.replace(" s", ""))
        except ValueError:
            return None
    return None
