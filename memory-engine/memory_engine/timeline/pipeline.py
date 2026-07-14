from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Callable

from memory_engine.core.config import EngineConfig
from memory_engine.core.db import Database
from memory_engine.timeline.summary import summarize_media_group

logger = logging.getLogger(__name__)
Progress = Callable[[str, int, int, str], None]


class TimelinePipeline:
    def __init__(self, config: EngineConfig, db: Database) -> None:
        self.config = config
        self.db = db

    def run(self, progress: Progress | None = None) -> dict[str, Any]:
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT id, taken_at, year, latitude, longitude, media_type, rel_path
                FROM media
                WHERE taken_at IS NOT NULL
                ORDER BY taken_at
                """
            ).fetchall()

        total = len(rows)
        by_day: dict[str, list] = defaultdict(list)
        for row in rows:
            day = row["taken_at"][:10]
            by_day[day].append(row)

        with self.db.connect() as conn:
            conn.execute("DELETE FROM media_events")
            conn.execute("DELETE FROM events")

        event_count = 0
        completed = 0
        for day, items in by_day.items():
            if len(items) < 3:
                completed += len(items)
                continue
            start = items[0]["taken_at"]
            end = items[-1]["taken_at"]
            name = f"Event {day}"
            summary = summarize_media_group(self.db, items)

            with self.db.connect() as conn:
                cur = conn.execute(
                    """
                    INSERT INTO events(name, start_at, end_at, summary, media_count)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (name, start, end, summary, len(items)),
                )
                event_id = int(cur.lastrowid)
                for item in items:
                    conn.execute(
                        "INSERT OR IGNORE INTO media_events(media_id, event_id) VALUES (?, ?)",
                        (int(item["id"]), event_id),
                    )
            event_count += 1
            completed += len(items)
            if progress:
                progress("timeline", completed, total, day)

        return {"total": total, "completed": completed, "events": event_count}
