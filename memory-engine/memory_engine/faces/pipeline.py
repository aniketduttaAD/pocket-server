from __future__ import annotations

import logging
from typing import Any, Callable

import numpy as np
from PIL import Image

from memory_engine.core.config import EngineConfig
from memory_engine.core.db import Database

logger = logging.getLogger(__name__)
Progress = Callable[[str, int, int, str], None]


class FacePipeline:
    def __init__(self, config: EngineConfig, db: Database) -> None:
        self.config = config
        self.db = db
        self._app = None

    def _get_app(self):
        if self._app is None:
            try:
                from insightface.app import FaceAnalysis
            except ImportError as exc:
                raise RuntimeError(
                    "insightface not installed. Run: pip install -r requirements.txt"
                ) from exc
            app = FaceAnalysis(
                name=self.config.face_model,
                root=str(self.config.models_dir),
                providers=["CPUExecutionProvider"],
            )
            app.prepare(ctx_id=-1, det_size=(320, 320))
            self._app = app
        return self._app

    def run(self, progress: Progress | None = None) -> dict[str, Any]:
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT id, abs_path FROM media
                WHERE media_type = 'image'
                ORDER BY id
                """
            ).fetchall()

        total = len(rows)
        completed = 0
        app = self._get_app()
        embeddings: list[np.ndarray] = []
        face_ids: list[int] = []

        for row in rows:
            media_id = int(row["id"])
            path = row["abs_path"]
            try:
                img = np.array(Image.open(path).convert("RGB"))
                faces = app.get(img)
            except Exception as exc:
                logger.warning("Face detect failed for %s: %s", path, exc)
                completed += 1
                if progress:
                    progress("faces", completed, total, path)
                continue

            with self.db.connect() as conn:
                conn.execute("DELETE FROM faces WHERE media_id = ?", (media_id,))
                for face in faces:
                    bbox = face.bbox.astype(float)
                    emb = face.embedding.astype(np.float32)
                    cur = conn.execute(
                        """
                        INSERT INTO faces(
                            media_id, bbox_x, bbox_y, bbox_w, bbox_h, embedding, confidence
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            media_id,
                            float(bbox[0]),
                            float(bbox[1]),
                            float(bbox[2] - bbox[0]),
                            float(bbox[3] - bbox[1]),
                            emb.tobytes(),
                            float(face.det_score),
                        ),
                    )
                    face_ids.append(int(cur.lastrowid))
                    embeddings.append(emb)

            completed += 1
            if progress:
                progress("faces", completed, total, path)

        if embeddings:
            self._cluster_faces(embeddings, face_ids)
        self._map_clusters_to_people()
        return {"total": total, "completed": completed, "faces": len(face_ids)}

    def _cluster_faces(self, embeddings: list[np.ndarray], face_ids: list[int]) -> None:
        try:
            import hdbscan
        except ImportError:
            logger.warning("hdbscan unavailable; assigning single cluster per face")
            with self.db.connect() as conn:
                for fid in face_ids:
                    cur = conn.execute(
                        "INSERT INTO face_clusters(face_count, confirmed, label) VALUES (1, 0, 'singleton')",
                    )
                    conn.execute("UPDATE faces SET cluster_id = ? WHERE id = ?", (cur.lastrowid, fid))
            return

        matrix = np.vstack(embeddings)
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        matrix = matrix / np.clip(norms, 1e-8, None)
        clusterer = hdbscan.HDBSCAN(min_cluster_size=3, metric="euclidean")
        labels = clusterer.fit_predict(matrix)

        with self.db.connect() as conn:
            conn.execute("DELETE FROM face_clusters")
            cluster_map: dict[int, int] = {}
            for label in set(labels):
                if label == -1:
                    continue
                cur = conn.execute(
                    "INSERT INTO face_clusters(face_count, confirmed, label) VALUES (0, 0, ?)",
                    (f"cluster_{label}",),
                )
                cluster_map[int(label)] = int(cur.lastrowid)

            for fid, label in zip(face_ids, labels):
                if label == -1:
                    cur = conn.execute(
                        "INSERT INTO face_clusters(face_count, confirmed, label) VALUES (1, 0, 'unknown')",
                    )
                    cid = int(cur.lastrowid)
                else:
                    cid = cluster_map[int(label)]
                conn.execute("UPDATE faces SET cluster_id = ? WHERE id = ?", (cid, fid))

            for cid in set(cluster_map.values()):
                count = conn.execute(
                    "SELECT COUNT(*) AS c FROM faces WHERE cluster_id = ?", (cid,)
                ).fetchone()["c"]
                conn.execute("UPDATE face_clusters SET face_count = ? WHERE id = ?", (count, cid))

    def _map_clusters_to_people(self) -> None:
        with self.db.connect() as conn:
            clusters = conn.execute(
                "SELECT id FROM face_clusters ORDER BY id"
            ).fetchall()
            for cluster in clusters:
                cid = int(cluster["id"])
                votes = conn.execute(
                    """
                    SELECT p.id, p.name, COUNT(*) AS c
                    FROM faces f
                    JOIN media_people mp ON mp.media_id = f.media_id
                    JOIN people p ON p.id = mp.person_id
                    WHERE f.cluster_id = ?
                    GROUP BY p.id, p.name
                    ORDER BY c DESC
                    LIMIT 1
                    """,
                    (cid,),
                ).fetchone()
                if votes:
                    person_id = int(votes["id"])
                    conn.execute(
                        "UPDATE face_clusters SET person_id = ?, confirmed = 1, label = ? WHERE id = ?",
                        (person_id, votes["name"], cid),
                    )
                    conn.execute(
                        "UPDATE faces SET person_id = ? WHERE cluster_id = ?",
                        (person_id, cid),
                    )
                    conn.execute(
                        "UPDATE people SET face_cluster_id = ? WHERE id = ?",
                        (cid, person_id),
                    )
                    media_rows = conn.execute(
                        "SELECT DISTINCT media_id FROM faces WHERE cluster_id = ?",
                        (cid,),
                    ).fetchall()
                    for m in media_rows:
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO media_people(media_id, person_id, source)
                            VALUES (?, ?, 'face_cluster')
                            """,
                            (int(m["media_id"]), person_id),
                        )
                else:
                    label = f"Unknown Person {cid}"
                    row = conn.execute("SELECT id FROM people WHERE name = ?", (label,)).fetchone()
                    if row:
                        person_id = int(row["id"])
                    else:
                        cur = conn.execute(
                            """
                            INSERT INTO people(name, display_name, source, confirmed, face_cluster_id)
                            VALUES (?, ?, 'face_cluster', 0, ?)
                            """,
                            (label, label, cid),
                        )
                        person_id = int(cur.lastrowid)
                    conn.execute(
                        "UPDATE face_clusters SET person_id = ?, label = ? WHERE id = ?",
                        (person_id, label, cid),
                    )
                    conn.execute(
                        "UPDATE faces SET person_id = ? WHERE cluster_id = ?",
                        (person_id, cid),
                    )
                    media_rows = conn.execute(
                        "SELECT DISTINCT media_id FROM faces WHERE cluster_id = ?",
                        (cid,),
                    ).fetchall()
                    for m in media_rows:
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO media_people(media_id, person_id, source)
                            VALUES (?, ?, 'face_cluster')
                            """,
                            (int(m["media_id"]), person_id),
                        )

        with self.db.connect() as conn:
            conn.execute(
                """
                UPDATE people SET photo_count = (
                    SELECT COUNT(*) FROM media_people mp WHERE mp.person_id = people.id
                )
                """
            )
