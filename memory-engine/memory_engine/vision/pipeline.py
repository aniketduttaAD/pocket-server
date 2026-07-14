from __future__ import annotations

import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any, Callable

import numpy as np
from PIL import Image
from tqdm import tqdm

from memory_engine.core.config import EngineConfig
from memory_engine.core.db import Database

logger = logging.getLogger(__name__)
Progress = Callable[[str, int, int, str], None]

SCENE_LABELS = [
    "a selfie photo",
    "a group photo of people",
    "a food photo",
    "a document or screenshot",
    "a landscape photo",
    "a beach photo",
    "an indoor photo",
    "a pet photo",
]

WARDROBE_LABELS = [
    "blue clothing",
    "red clothing",
    "white shirt",
    "kurta outfit",
    "formal outfit",
    "casual outfit",
]


class VisionPipeline:
    def __init__(self, config: EngineConfig, db: Database) -> None:
        self.config = config
        self.db = db
        self._model = None
        self._preprocess = None
        self._tokenizer = None
        self._device = self._pick_device()

    def _pick_device(self) -> str:
        import torch

        # CPU is more stable for long batch jobs; set MEMORY_ENGINE_DEVICE=mps to override.
        forced = os.environ.get("MEMORY_ENGINE_DEVICE")
        if forced:
            return forced
        return "cpu"

    def _load_model(self):
        if self._model is None:
            import open_clip
            import torch

            model, _, preprocess = open_clip.create_model_and_transforms(
                self.config.vision_model,
                pretrained=self.config.vision_pretrained,
            )
            tokenizer = open_clip.get_tokenizer(self.config.vision_model)
            model.eval()
            model.to(self._device)
            self._model = model
            self._preprocess = preprocess
            self._tokenizer = tokenizer
        return self._model, self._preprocess, self._tokenizer

    def run(self, progress: Progress | None = None) -> dict[str, Any]:
        import torch
        with self.db.connect() as conn:
            images = conn.execute(
                "SELECT id, abs_path, album FROM media WHERE media_type = 'image' ORDER BY id"
            ).fetchall()
            videos = conn.execute(
                "SELECT id, abs_path FROM media WHERE media_type = 'video' ORDER BY id"
            ).fetchall()

        model, preprocess, tokenizer = self._load_model()
        items: list[tuple[int, Path, str]] = []
        for r in images:
            items.append((int(r["id"]), Path(r["abs_path"]), "image"))
        for r in videos:
            items.append((int(r["id"]), Path(r["abs_path"]), "video"))

        total = len(items)
        vectors: list[np.ndarray] = []
        media_ids: list[int] = []
        completed = 0

        text_features = self._encode_texts(model, tokenizer, SCENE_LABELS + WARDROBE_LABELS)

        for media_id, path, media_type in tqdm(items, desc="Vision", unit="item"):
            try:
                img_path = path
                if media_type == "video":
                    kf_path = self._extract_keyframe(path, media_id)
                    if kf_path is None:
                        logger.warning("Failed to extract keyframe for video %s", path)
                        completed += 1
                        if progress:
                            progress("vision", completed, total, str(path))
                        continue
                    img_path = kf_path

                img = Image.open(img_path).convert("RGB")
                tensor = preprocess(img).unsqueeze(0).to(self._device)
                with torch.no_grad():
                    feat = model.encode_image(tensor)
                    feat = feat / feat.norm(dim=-1, keepdim=True)
                vec = feat.cpu().numpy().astype(np.float32)[0]
                vectors.append(vec)
                media_ids.append(media_id)

                scene_tags = self._zero_shot(vec, text_features[: len(SCENE_LABELS)], SCENE_LABELS)
                wardrobe_tags: list[str] = []
                with self.db.connect() as conn:
                    row = conn.execute("SELECT album FROM media WHERE id = ?", (media_id,)).fetchone()
                    if row and row["album"] == "Wardrobe":
                        wardrobe_tags = self._zero_shot(
                            vec,
                            text_features[len(SCENE_LABELS) :],
                            WARDROBE_LABELS,
                        )
                    conn.execute(
                        """
                        UPDATE media SET scene_tags = ?, wardrobe_tags = ? WHERE id = ?
                        """,
                        (json.dumps(scene_tags), json.dumps(wardrobe_tags), media_id),
                    )
                if len(vectors) % 500 == 0:
                    self._save_faiss(vectors, media_ids, model_name=self.config.vision_model)
            except Exception as exc:
                logger.warning("Vision embed failed %s: %s", path, exc)
            completed += 1
            if progress:
                progress("vision", completed, total, str(path))

        if vectors:
            self._save_faiss(vectors, media_ids, model_name=self.config.vision_model)
        self.db.rebuild_fts()
        return {"total": total, "completed": completed, "embedded": len(vectors)}

    def _encode_texts(self, model, tokenizer, labels: list[str]) -> np.ndarray:
        import torch

        tokens = tokenizer(labels).to(self._device)
        with torch.no_grad():
            feats = model.encode_text(tokens)
            feats = feats / feats.norm(dim=-1, keepdim=True)
        return feats.cpu().numpy().astype(np.float32)

    def _zero_shot(self, image_vec: np.ndarray, text_features: np.ndarray, labels: list[str]) -> list[str]:
        scores = text_features @ image_vec
        top_idx = int(np.argmax(scores))
        if scores[top_idx] < 0.2:
            return []
        return [labels[top_idx]]

    def _extract_keyframe(self, video_path: Path, media_id: int) -> Path | None:
        out = self.config.data_dir / "keyframes" / f"{video_path.stem}_{media_id}.jpg"
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.exists():
            return out
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(video_path),
            "-ss",
            "00:00:01",
            "-vframes",
            "1",
            "-q:v",
            "2",
            str(out),
        ]
        try:
            subprocess.run(cmd, capture_output=True, check=True)
            return out if out.exists() else None
        except Exception:
            return None

    def _save_faiss(self, vectors: list[np.ndarray], media_ids: list[int], model_name: str) -> None:
        import faiss

        matrix = np.vstack(vectors).astype(np.float32)
        dim = matrix.shape[1]
        index = faiss.IndexFlatIP(dim)
        index.add(matrix)
        faiss.write_index(index, str(self.config.faiss_path))

        with self.db.connect() as conn:
            conn.execute("DELETE FROM embeddings")
            for faiss_id, media_id in enumerate(media_ids):
                conn.execute(
                    """
                    INSERT INTO embeddings(media_id, model_name, faiss_id)
                    VALUES (?, ?, ?)
                    """,
                    (media_id, model_name, faiss_id),
                )
        self.db.set_state("faiss_media_ids", json.dumps(media_ids))

    @staticmethod
    def load_index(config: EngineConfig) -> tuple[Any | None, list[int]]:
        import os

        os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
        import faiss

        if not config.faiss_path.exists():
            return None, []
        index = faiss.read_index(str(config.faiss_path))
        raw = Database(config.db_path).get_state("faiss_media_ids", "[]")
        media_ids = json.loads(raw or "[]")
        return index, media_ids
