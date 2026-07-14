from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from memory_engine.core.config import EngineConfig
from memory_engine.core.db import Database, utc_now

logger = logging.getLogger(__name__)

STAGES = [
    "catalog",
    "faces",
    "geo",
    "vision",
    "dedup",
    "video",
    "timeline",
]


class PipelineRunner:
    def __init__(self, config: EngineConfig, db: Database) -> None:
        self.config = config
        self.db = db
        self._progress_cb: ProgressCallback | None = None

    def set_progress_callback(self, cb: ProgressCallback) -> None:
        self._progress_cb = cb

    def _emit(self, stage: str, completed: int, total: int, message: str = "") -> None:
        if self._progress_cb:
            self._progress_cb(stage, completed, total, message)
        if total and completed % max(1, total // 20) == 0:
            logger.info("[%s] %d/%d %s", stage, completed, total, message)

    def _start_job(self, stage: str, total: int) -> int:
        with self.db.connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO processing_jobs(stage, status, total, completed, started_at)
                VALUES (?, 'running', ?, 0, ?)
                """,
                (stage, total, utc_now()),
            )
            return int(cur.lastrowid)

    def _finish_job(self, job_id: int, status: str, completed: int, error: str | None = None) -> None:
        with self.db.connect() as conn:
            conn.execute(
                """
                UPDATE processing_jobs
                SET status = ?, completed = ?, error = ?, finished_at = ?
                WHERE id = ?
                """,
                (status, completed, error, utc_now(), job_id),
            )

    def run_stage(self, stage: str, full: bool = False) -> dict[str, Any]:
        if stage == "catalog":
            from memory_engine.catalog.scanner import CatalogScanner

            runner = lambda: CatalogScanner(self.config, self.db).run(full=full, progress=self._emit)
        elif stage == "faces":
            from memory_engine.faces.pipeline import FacePipeline

            runner = lambda: FacePipeline(self.config, self.db).run(progress=self._emit)
        elif stage == "geo":
            from memory_engine.geo.pipeline import GeoPipeline

            runner = lambda: GeoPipeline(self.config, self.db).run(progress=self._emit)
        elif stage == "vision":
            from memory_engine.vision.pipeline import VisionPipeline

            runner = lambda: VisionPipeline(self.config, self.db).run(progress=self._emit)
        elif stage == "dedup":
            from memory_engine.dedup.pipeline import DedupPipeline

            runner = lambda: DedupPipeline(self.config, self.db).run(progress=self._emit)
        elif stage == "video":
            from memory_engine.video.pipeline import VideoPipeline

            runner = lambda: VideoPipeline(self.config, self.db).run(progress=self._emit)
        elif stage == "timeline":
            from memory_engine.timeline.pipeline import TimelinePipeline

            runner = lambda: TimelinePipeline(self.config, self.db).run(progress=self._emit)
        else:
            raise ValueError(f"Unknown stage: {stage}")

        job_id = self._start_job(stage, 0)
        try:
            result = runner()
            total = int(result.get("total", 0))
            completed = int(result.get("completed", 0))
            with self.db.connect() as conn:
                conn.execute(
                    "UPDATE processing_jobs SET total = ? WHERE id = ?",
                    (total, job_id),
                )
            self._finish_job(job_id, "done", completed)
            self.db.set_state(f"stage_{stage}_completed", utc_now())
            return result
        except Exception as exc:
            logger.exception("Stage %s failed", stage)
            self._finish_job(job_id, "failed", 0, str(exc))
            raise

    def run_all(self, full: bool = False, stages: list[str] | None = None) -> dict[str, Any]:
        selected = stages or STAGES
        results: dict[str, Any] = {}
        for stage in selected:
            logger.info("Running stage: %s", stage)
            results[stage] = self.run_stage(stage, full=full)
        self.db.rebuild_fts()
        self.db.set_state("last_full_pipeline", utc_now())
        return results

    def latest_jobs(self, limit: int = 20) -> list[dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM processing_jobs
                ORDER BY id DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]
