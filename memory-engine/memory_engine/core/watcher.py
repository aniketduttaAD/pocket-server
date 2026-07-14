from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Callable

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from memory_engine.core.config import EngineConfig
from memory_engine.core.db import Database
from memory_engine.core.pipeline import PipelineRunner

logger = logging.getLogger(__name__)


class _MediaHandler(FileSystemEventHandler):
    def __init__(self, on_change: Callable[[Path], None]) -> None:
        self.on_change = on_change

    def on_created(self, event) -> None:
        if not event.is_directory:
            self.on_change(Path(event.src_path))

    def on_modified(self, event) -> None:
        if not event.is_directory:
            self.on_change(Path(event.src_path))


class IncrementalWatcher:
    def __init__(self, config: EngineConfig, db: Database) -> None:
        self.config = config
        self.db = db
        self.runner = PipelineRunner(config, db)
        self._pending: set[str] = set()
        self._lock = threading.Lock()
        self._observer: Observer | None = None

    def _schedule(self, path: Path) -> None:
        suffix = path.suffix.lower()
        if suffix not in {".jpg", ".jpeg", ".png", ".mp4", ".mov"}:
            return
        with self._lock:
            self._pending.add(str(path))

    def _drain(self) -> None:
        while True:
            time.sleep(5)
            with self._lock:
                if not self._pending:
                    continue
                self._pending.clear()
            logger.info("Incremental ingest triggered")
            try:
                self.runner.run_all(full=False)
            except Exception as exc:
                logger.exception("Incremental ingest failed: %s", exc)

    def start(self) -> None:
        handler = _MediaHandler(self._schedule)
        observer = Observer()
        observer.schedule(handler, str(self.config.photos_root), recursive=True)
        observer.start()
        self._observer = observer
        threading.Thread(target=self._drain, daemon=True).start()
        logger.info("Watching %s for new media", self.config.photos_root)

    def stop(self) -> None:
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=5)
