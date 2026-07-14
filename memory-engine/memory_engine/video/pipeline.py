from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from typing import Any, Callable

from tqdm import tqdm

from memory_engine.core.config import EngineConfig
from memory_engine.core.db import Database

logger = logging.getLogger(__name__)
Progress = Callable[[str, int, int, str], None]


class VideoPipeline:
    def __init__(self, config: EngineConfig, db: Database) -> None:
        self.config = config
        self.db = db
        self._whisper = None

    def _get_whisper(self):
        if self._whisper is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:
                raise RuntimeError("faster-whisper not installed") from exc
            device = "cpu"
            compute_type = "int8"
            self._whisper = WhisperModel(self.config.whisper_model, device=device, compute_type=compute_type)
        return self._whisper

    def _has_audio(self, path: Path) -> bool:
        cmd = [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            str(path),
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            return "audio" in result.stdout
        except Exception:
            return False

    def run(self, progress: Progress | None = None) -> dict[str, Any]:
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT id, abs_path FROM media WHERE media_type = 'video' ORDER BY id"
            ).fetchall()

        total = len(rows)
        completed = 0
        transcribed = 0
        model = self._get_whisper()

        for row in tqdm(rows, desc="Video", unit="vid"):
            media_id = int(row["id"])
            path = Path(row["abs_path"])
            self._probe_metadata(media_id, path)
            if not self._has_audio(path):
                completed += 1
                if progress:
                    progress("video", completed, total, str(path))
                continue
            try:
                segments_iter, _ = model.transcribe(str(path), beam_size=1)
                segments = []
                texts = []
                for seg in segments_iter:
                    item = {"start": seg.start, "end": seg.end, "text": seg.text.strip()}
                    if item["text"]:
                        segments.append(item)
                        texts.append(item["text"])
                full_text = " ".join(texts).strip()
                if full_text:
                    with self.db.connect() as conn:
                        conn.execute(
                            """
                            INSERT INTO transcripts(media_id, text, segments)
                            VALUES (?, ?, ?)
                            ON CONFLICT(media_id) DO UPDATE SET
                                text = excluded.text,
                                segments = excluded.segments
                            """,
                            (media_id, full_text, json.dumps(segments)),
                        )
                    transcribed += 1
            except Exception as exc:
                logger.warning("Transcribe failed %s: %s", path, exc)
            completed += 1
            if progress:
                progress("video", completed, total, str(path))

        self.db.rebuild_fts()
        return {"total": total, "completed": completed, "transcribed": transcribed}

    def _probe_metadata(self, media_id: int, path: Path) -> None:
        cmd = [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(path),
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            data = json.loads(result.stdout)
            width = height = None
            duration = None
            streams = data.get("streams") or []
            if streams:
                width = streams[0].get("width")
                height = streams[0].get("height")
            fmt = data.get("format") or {}
            duration = fmt.get("duration")
            with self.db.connect() as conn:
                conn.execute(
                    """
                    UPDATE media SET width = ?, height = ?, duration_sec = ? WHERE id = ?
                    """,
                    (width, height, float(duration) if duration else None, media_id),
                )
        except Exception as exc:
            logger.debug("ffprobe failed %s: %s", path, exc)
