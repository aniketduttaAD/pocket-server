"""Isolated FAISS + CLIP text search — runs in a subprocess to avoid segfaults with PyTorch in the API server."""
from __future__ import annotations

import json
import os
import sys

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import numpy as np

from memory_engine.core.config import load_config
from memory_engine.core.db import Database


def _encode_text(config, text: str) -> np.ndarray:
    import open_clip
    import torch

    device = "cpu"
    try:
        model, _, _ = open_clip.create_model_and_transforms(
            config.vision_model,
            config.vision_pretrained,
            cache_dir=str(config.models_dir),
        )
    except Exception:
        model, _, _ = open_clip.create_model_and_transforms(
            config.vision_model,
            config.vision_pretrained,
        )
    tokenizer = open_clip.get_tokenizer(config.vision_model)
    model.eval().to(device)
    tokens = tokenizer([text]).to(device)
    with torch.no_grad():
        feat = model.encode_text(tokens)
        feat = feat / feat.norm(dim=-1, keepdim=True)
    return feat.cpu().numpy().astype(np.float32)


def find_similar_vectors(media_id: int, limit: int = 24) -> list[dict]:
    config = load_config()
    db = Database(config.db_path)

    if not config.faiss_path.exists():
        return []

    import faiss

    index = faiss.read_index(str(config.faiss_path))
    if index.ntotal == 0:
        return []

    with db.connect() as conn:
        row = conn.execute(
            "SELECT faiss_id FROM embeddings WHERE media_id = ?",
            (media_id,),
        ).fetchone()
    if not row:
        return []

    faiss_id = int(row["faiss_id"])
    vec = index.reconstruct(faiss_id).reshape(1, -1).astype(np.float32)
    scores, idxs = index.search(vec, min(limit + 1, index.ntotal))

    results: list[dict] = []
    with db.connect() as conn:
        for score, idx in zip(scores[0], idxs[0]):
            if idx < 0:
                continue
            media_row = conn.execute(
                """
                SELECT m.* FROM embeddings e
                JOIN media m ON m.id = e.media_id
                WHERE e.faiss_id = ?
                """,
                (int(idx),),
            ).fetchone()
            if not media_row or int(media_row["id"]) == media_id:
                continue
            item = dict(media_row)
            item["score"] = float(score)
            results.append(item)
    return results[:limit]


def text_search_vectors(
    text: str,
    limit: int = 40,
    person_id: int | None = None,
) -> list[dict]:
    config = load_config()
    db = Database(config.db_path)

    if not config.faiss_path.exists():
        return []

    import faiss

    index = faiss.read_index(str(config.faiss_path))
    if index.ntotal == 0:
        return []

    allowed_ids: set[int] | None = None
    if person_id is not None:
        with db.connect() as conn:
            rows = conn.execute(
                """
                SELECT m.id FROM media m
                JOIN media_people mp ON mp.media_id = m.id
                WHERE mp.person_id = ?
                UNION
                SELECT DISTINCT m.id FROM media m
                JOIN faces f ON f.media_id = m.id
                WHERE f.person_id = ?
                """,
                (person_id, person_id),
            ).fetchall()
        allowed_ids = {int(r["id"]) for r in rows}
        if not allowed_ids:
            return []

    text_vec = _encode_text(config, text)
    search_k = min(max(limit * 4, limit), index.ntotal)
    scores, idxs = index.search(text_vec, search_k)

    results: list[dict] = []
    with db.connect() as conn:
        for score, idx in zip(scores[0], idxs[0]):
            if idx < 0:
                continue
            media_row = conn.execute(
                """
                SELECT m.* FROM embeddings e
                JOIN media m ON m.id = e.media_id
                WHERE e.faiss_id = ?
                """,
                (int(idx),),
            ).fetchone()
            if not media_row:
                continue
            mid = int(media_row["id"])
            if allowed_ids is not None and mid not in allowed_ids:
                continue
            item = dict(media_row)
            item["score"] = float(score)
            results.append(item)
            if len(results) >= limit:
                break
    return results


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: faiss_ops similar|text ...", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "similar":
        media_id = int(sys.argv[2])
        limit = int(sys.argv[3])
        print(json.dumps(find_similar_vectors(media_id, limit)))
    elif cmd == "text":
        text = sys.argv[2]
        limit = int(sys.argv[3])
        person_id = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] != "0" else None
        print(json.dumps(text_search_vectors(text, limit, person_id)))
    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)
