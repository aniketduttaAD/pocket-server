from __future__ import annotations

import logging
from typing import Any, Callable

import imagehash
import numpy as np
from PIL import Image
from tqdm import tqdm

from memory_engine.core.config import EngineConfig
from memory_engine.core.db import Database

logger = logging.getLogger(__name__)
Progress = Callable[[str, int, int, str], None]


class DedupPipeline:
    def __init__(self, config: EngineConfig, db: Database) -> None:
        self.config = config
        self.db = db

    def run(self, progress: Progress | None = None) -> dict[str, Any]:
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT id, abs_path FROM media WHERE media_type = 'image' ORDER BY id"
            ).fetchall()

        total = len(rows)
        hashes: list[tuple[int, imagehash.ImageHash]] = []
        completed = 0
        for row in tqdm(rows, desc="Dedup", unit="img"):
            media_id = int(row["id"])
            path = row["abs_path"]
            try:
                ph = imagehash.phash(Image.open(path))
                hashes.append((media_id, ph))
                with self.db.connect() as conn:
                    conn.execute("UPDATE media SET phash = ? WHERE id = ?", (str(ph), media_id))
            except Exception as exc:
                logger.debug("phash failed %s: %s", path, exc)
            completed += 1
            if progress:
                progress("dedup", completed, total, path)

        groups = self._group_hashes(hashes)
        clip_groups = self._group_by_clip()
        all_groups = groups + clip_groups
        self._persist_groups(all_groups)
        return {"total": total, "completed": completed, "groups": len(all_groups)}

    def _group_hashes(self, hashes: list[tuple[int, imagehash.ImageHash]]) -> list[list[int]]:
        groups: list[list[int]] = []
        used: set[int] = set()
        for i, (mid_a, ha) in enumerate(hashes):
            if mid_a in used:
                continue
            group = [mid_a]
            used.add(mid_a)
            for mid_b, hb in hashes[i + 1 :]:
                if mid_b in used:
                    continue
                if ha - hb <= 5:
                    group.append(mid_b)
                    used.add(mid_b)
            if len(group) > 1:
                groups.append(group)
        return groups

    def _group_by_clip(self) -> list[list[int]]:
        try:
            import faiss
            import json

            if not self.config.faiss_path.exists():
                return []
            index = faiss.read_index(str(self.config.faiss_path))
            raw = self.db.get_state("faiss_media_ids", "[]")
            media_ids = json.loads(raw or "[]")
            if not media_ids:
                return []
            vectors = np.vstack([index.reconstruct(i) for i in range(index.ntotal)])
        except Exception:
            return []

        groups: list[list[int]] = []
        used: set[int] = set()
        for i, mid in enumerate(media_ids):
            if mid in used:
                continue
            sims, idxs = index.search(vectors[i : i + 1], min(10, index.ntotal))
            group = [mid]
            used.add(mid)
            for sim, idx in zip(sims[0], idxs[0]):
                if idx < 0:
                    continue
                other = media_ids[idx]
                if other in used:
                    continue
                if sim >= 0.97:
                    group.append(other)
                    used.add(other)
            if len(group) > 1:
                groups.append(group)
        return groups

    def _persist_groups(self, groups: list[list[int]]) -> None:
        with self.db.connect() as conn:
            conn.execute("DELETE FROM media_duplicates")
            conn.execute("DELETE FROM duplicate_groups")
            for group in groups:
                rep = group[0]
                cur = conn.execute(
                    "INSERT INTO duplicate_groups(representative_media_id, member_count) VALUES (?, ?)",
                    (rep, len(group)),
                )
                gid = int(cur.lastrowid)
                for mid in group:
                    conn.execute(
                        "INSERT OR IGNORE INTO media_duplicates(media_id, group_id, similarity) VALUES (?, ?, ?)",
                        (mid, gid, 1.0 if mid == rep else 0.95),
                    )
