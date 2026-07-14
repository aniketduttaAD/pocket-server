from __future__ import annotations

import os

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import json
import logging
import re
from typing import Any

import numpy as np
import torch

from memory_engine.core.config import EngineConfig
from memory_engine.core.db import Database

logger = logging.getLogger(__name__)

MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}

# Never treat these as person-name tokens.
VISUAL_ATTRS = {
    "smiling", "smile", "smiles", "happy", "laughing", "laugh", "sad", "crying",
    "selfie", "selfies", "food", "beach", "landscape", "indoor", "outdoor", "pet",
    "group", "formal", "casual", "outfit", "wardrobe", "travel", "trip", "home",
    "recent", "latest", "oldest", "best", "candid", "portrait", "closeup", "close",
}


def _expand_visual_query(terms: list[str]) -> str:
    """Map common intent words to CLIP-friendly phrases."""
    joined = " ".join(terms).lower()
    if any(w in joined for w in ("smiling", "smile", "happy", "laugh")):
        return "a smiling selfie photo"
    if "selfie" in joined:
        return "a selfie photo"
    if "food" in joined:
        return "a food photo"
    if "beach" in joined:
        return "a beach photo"
    return joined or "a photo"


def parse_query(query: str) -> dict[str, Any]:
    q = query.lower().strip()
    filters: dict[str, Any] = {"visual_terms": []}

    year_match = re.search(r"\b(20\d{2})\b", q)
    if year_match:
        filters["year"] = int(year_match.group(1))

    for month_name, month_num in MONTHS.items():
        if month_name in q:
            filters["month"] = month_num
            break

    if "wardrobe" in q or "outfit" in q:
        filters["album"] = "Wardrobe"

    visual_stop = {
        "with", "from", "and", "the", "my", "in", "at", "of", "photos", "photo",
        "videos", "video", "all", "show", "find", "get", "me", "pics", "pictures",
    }
    tokens = [t for t in re.findall(r"[a-zA-Z]+", q) if t not in visual_stop and t not in MONTHS]
    filters["visual_terms"] = tokens
    filters["raw_person_terms"] = tokens
    filters["raw_place_terms"] = tokens
    if "home" in q.split():
        filters["home_only"] = True
    return filters


class HybridSearch:
    def __init__(self, config: EngineConfig, db: Database) -> None:
        self.config = config
        self.db = db
        self._clip = None

    def _clip_model(self):
        if self._clip is None:
            import open_clip
            import torch

            device = "cpu"
            try:
                model, _, _ = open_clip.create_model_and_transforms(
                    self.config.vision_model,
                    pretrained=self.config.vision_pretrained,
                    cache_dir=str(self.config.models_dir),
                )
            except Exception:
                model, _, _ = open_clip.create_model_and_transforms(
                    self.config.vision_model,
                    pretrained=self.config.vision_pretrained,
                )
            tokenizer = open_clip.get_tokenizer(self.config.vision_model)
            model.eval().to(device)
            self._clip = (model, tokenizer, device)
        return self._clip

    def search(self, query: str, limit: int = 40) -> list[dict[str, Any]]:
        filters = parse_query(query)
        self._resolve_people(query, filters)
        candidates = self._filter_candidates(filters, query)

        visual_terms = self._visual_only_terms(filters)
        metadata_query = self._has_metadata_filters(filters)
        person_ids = filters.get("resolved_person_ids") or []

        # Person + visual: CLIP search scoped to that person's photos (subprocess).
        if visual_terms and person_ids and self.config.faiss_path.exists():
            scoped = self._faiss_text_search_subprocess(
                _expand_visual_query(visual_terms),
                limit * 2,
                person_id=person_ids[0] if len(person_ids) == 1 else None,
            )
            if scoped:
                candidates = scoped
            elif candidates:
                candidates = self._filter_visual_candidates(candidates, visual_terms, limit * 2)

        elif not candidates and visual_terms and self.config.faiss_path.exists():
            candidates = self._faiss_text_search_subprocess(
                _expand_visual_query(visual_terms), limit * 2
            )

        if not candidates:
            return []

        if visual_terms and not person_ids and not metadata_query and self.config.faiss_path.exists():
            try:
                candidates = self._clip_rerank(" ".join(visual_terms), candidates, limit * 2)
            except Exception as exc:
                logger.warning("CLIP rerank unavailable, using metadata/FTS results: %s", exc)
                candidates = self._faiss_text_search_subprocess(
                    _expand_visual_query(visual_terms), limit * 2
                ) or candidates

        deduped = self._dedupe_results(candidates)
        return deduped[:limit]

    def _resolve_people(self, query: str, filters: dict[str, Any]) -> None:
        """Match full person names from DB against the query string."""
        q = query.lower()
        matched_ids: list[int] = []
        matched_names: list[str] = []
        matched_tokens: set[str] = set()

        with self.db.connect() as conn:
            people = conn.execute(
                "SELECT id, name FROM people WHERE name NOT LIKE 'Unknown Person%'"
            ).fetchall()

        for person in sorted(people, key=lambda p: len(p["name"] or ""), reverse=True):
            name = (person["name"] or "").lower().strip()
            if len(name) < 2:
                continue
            if name in q:
                matched_ids.append(int(person["id"]))
                matched_names.append(name)
                matched_tokens.update(name.split())

        filters["resolved_person_ids"] = list(dict.fromkeys(matched_ids))
        filters["matched_person_terms"] = list(matched_tokens)
        # Remove matched name tokens and visual attrs from person/place token lists
        filters["raw_person_terms"] = [
            t for t in filters.get("raw_person_terms", [])
            if t not in matched_tokens and t not in VISUAL_ATTRS
        ]
        filters["raw_place_terms"] = [
            t for t in filters.get("raw_place_terms", [])
            if t not in matched_tokens and t not in VISUAL_ATTRS
        ]

    def _filter_visual_candidates(
        self, candidates: list[dict[str, Any]], visual_terms: list[str], limit: int
    ) -> list[dict[str, Any]]:
        """Narrow person-filtered results using scene tags for common visual intents."""
        joined = " ".join(visual_terms).lower()

        if any(w in joined for w in ("smiling", "smile", "happy", "laugh", "selfie")):
            selfies = [c for c in candidates if "selfie" in (c.get("scene_tags") or "").lower()]
            if selfies:
                return selfies[:limit]

        if "food" in joined:
            food = [c for c in candidates if "food" in (c.get("scene_tags") or "").lower()]
            if food:
                return food[:limit]

        if "beach" in joined:
            beach = [c for c in candidates if "beach" in (c.get("scene_tags") or "").lower()]
            if beach:
                return beach[:limit]

        if "group" in joined:
            group = [c for c in candidates if "group" in (c.get("scene_tags") or "").lower()]
            if group:
                return group[:limit]

        return candidates[:limit]

    def _rank_by_scene_tags(
        self, candidates: list[dict[str, Any]], visual_terms: list[str], limit: int
    ) -> list[dict[str, Any]]:
        """Boost selfies when user asks about smiling/happy."""
        want_selfie = any(t in VISUAL_ATTRS for t in visual_terms) or any(
            w in visual_terms for w in ("smiling", "smile", "happy", "selfie")
        )
        if not want_selfie:
            return candidates[:limit]

        def score(item: dict[str, Any]) -> int:
            tags = (item.get("scene_tags") or "").lower()
            s = 0
            if "selfie" in tags:
                s += 2
            if "group" in tags:
                s += 1
            return s

        ranked = sorted(candidates, key=score, reverse=True)
        return ranked[:limit]

    def _faiss_text_search_subprocess(
        self, text: str, limit: int, person_id: int | None = None
    ) -> list[dict[str, Any]]:
        import subprocess
        import sys

        args = [
            sys.executable,
            "-m",
            "memory_engine.search.faiss_ops",
            "text",
            text,
            str(limit),
            str(person_id or 0),
        ]
        try:
            proc = subprocess.run(
                args,
                capture_output=True,
                text=True,
                timeout=180,
                env={**os.environ, "KMP_DUPLICATE_LIB_OK": "TRUE"},
            )
            if proc.returncode != 0:
                logger.warning("FAISS text search failed: %s", proc.stderr.strip())
                return []
            return json.loads(proc.stdout)
        except Exception as exc:
            logger.warning("FAISS text search error: %s", exc)
            return []

    def _visual_only_terms(self, filters: dict[str, Any]) -> list[str]:
        matched = set(filters.get("matched_person_terms") or [])
        matched |= set(filters.get("matched_place_terms") or [])
        return [t for t in (filters.get("visual_terms") or []) if t not in matched]

    def _has_metadata_filters(self, filters: dict[str, Any]) -> bool:
        return bool(
            filters.get("year")
            or filters.get("month")
            or filters.get("album")
            or filters.get("resolved_person_ids")
            or filters.get("matched_place_ids")
            or filters.get("home_only")
        )

    def _match_places(self, filters: dict[str, Any]) -> list[int]:
        """Match query terms against geocoded place names; prefer places matching more terms."""
        if filters.get("home_only"):
            with self.db.connect() as conn:
                rows = conn.execute(
                    "SELECT id FROM places WHERE is_home = 1"
                ).fetchall()
            if rows:
                filters["matched_place_terms"] = ["home"]
                return [int(r["id"]) for r in rows]
            return []

        terms = [
            t for t in filters.get("raw_place_terms", [])
            if t not in (filters.get("matched_person_terms") or [])
        ]
        if not terms:
            return []

        with self.db.connect() as conn:
            places = conn.execute(
                "SELECT id, geocode_name, name FROM places"
            ).fetchall()

        scored: list[tuple[int, int]] = []
        for place in places:
            label = f"{place['geocode_name'] or ''} {place['name'] or ''}".lower()
            score = sum(1 for term in terms if term in label)
            if score > 0:
                scored.append((score, int(place["id"])))

        if not scored:
            return []

        max_score = max(s for s, _ in scored)
        place_ids = [pid for s, pid in scored if s == max_score]
        filters["matched_place_terms"] = [
            t for t in terms
            if any(t in f"{p['geocode_name'] or ''} {p['name'] or ''}".lower()
                   for p in places if int(p["id"]) in place_ids)
        ]
        return place_ids

    def _filter_candidates(self, filters: dict[str, Any], query: str) -> list[dict[str, Any]]:
        clauses = ["1=1"]
        params: list[Any] = []

        if filters.get("year"):
            clauses.append("m.year = ?")
            params.append(filters["year"])
        if filters.get("month"):
            clauses.append("CAST(strftime('%m', m.taken_at) AS INTEGER) = ?")
            params.append(filters["month"])
        if filters.get("album"):
            clauses.append("m.album = ?")
            params.append(filters["album"])

        person_ids: list[int] = list(filters.get("resolved_person_ids") or [])
        matched_person_terms: list[str] = list(filters.get("matched_person_terms") or [])

        if not person_ids:
            with self.db.connect() as conn:
                for term in filters.get("raw_person_terms", []):
                    if term in VISUAL_ATTRS:
                        continue
                    rows = conn.execute(
                        "SELECT id FROM people WHERE lower(name) LIKE ?",
                        (f"%{term}%",),
                    ).fetchall()
                    if rows:
                        matched_person_terms.append(term)
                        person_ids.extend(int(r["id"]) for r in rows)
            filters["matched_person_terms"] = matched_person_terms
            filters["resolved_person_ids"] = list(dict.fromkeys(person_ids))

        place_ids = self._match_places(filters)
        filters["matched_place_ids"] = place_ids

        join_people = ""
        if person_ids:
            placeholders = ",".join("?" * len(set(person_ids)))
            join_people = f"JOIN media_people mp ON mp.media_id = m.id AND mp.person_id IN ({placeholders})"
            params = list(set(person_ids)) + params

        join_places = ""
        if place_ids:
            placeholders = ",".join("?" * len(place_ids))
            join_places = f"JOIN media_places mpl ON mpl.media_id = m.id AND mpl.place_id IN ({placeholders})"
            params = place_ids + params

        sql = f"""
            SELECT DISTINCT m.*
            FROM media m
            {join_people}
            {join_places}
            WHERE {' AND '.join(clauses)}
            ORDER BY m.taken_at DESC
            LIMIT 500
        """
        with self.db.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
            results = [dict(r) for r in rows]

        if not results and query.strip():
            with self.db.connect() as conn:
                fts_rows = conn.execute(
                    """
                    SELECT m.*
                    FROM media_fts f
                    JOIN media m ON m.id = f.rowid
                    WHERE media_fts MATCH ?
                    ORDER BY rank
                    LIMIT 200
                    """,
                    (query,),
                ).fetchall()
                results = [dict(r) for r in fts_rows]
        return results

    def _clip_rerank(self, text: str, candidates: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
        from memory_engine.vision.pipeline import VisionPipeline

        import numpy as np

        index, media_ids = VisionPipeline.load_index(self.config)
        if index is None:
            return candidates[:limit]

        id_to_faiss = {}
        with self.db.connect() as conn:
            for row in conn.execute("SELECT media_id, faiss_id FROM embeddings"):
                id_to_faiss[int(row["media_id"])] = int(row["faiss_id"])

        model, tokenizer, device = self._clip_model()
        import torch

        tokens = tokenizer([text]).to(device)
        with torch.no_grad():
            text_feat = model.encode_text(tokens)
            text_feat = text_feat / text_feat.norm(dim=-1, keepdim=True)
        text_vec = text_feat.cpu().numpy().astype(np.float32)[0]

        scored: list[tuple[float, dict[str, Any]]] = []
        for item in candidates:
            faiss_id = id_to_faiss.get(int(item["id"]))
            if faiss_id is None:
                scored.append((0.0, item))
                continue
            vec = index.reconstruct(faiss_id)
            score = float(np.dot(vec, text_vec))
            scored.append((score, {**item, "score": score}))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [item for _, item in scored[:limit]]

    def _dedupe_results(self, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen_groups: set[int] = set()
        final: list[dict[str, Any]] = []
        with self.db.connect() as conn:
            for item in results:
                row = conn.execute(
                    "SELECT group_id FROM media_duplicates WHERE media_id = ?",
                    (int(item["id"]),),
                ).fetchone()
                if row:
                    gid = int(row["group_id"])
                    if gid in seen_groups:
                        continue
                    seen_groups.add(gid)
                final.append(item)
        return final

    def find_similar(self, media_id: int, limit: int = 24) -> list[dict[str, Any]]:
        import subprocess
        import sys

        try:
            proc = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "memory_engine.search.faiss_ops",
                    "similar",
                    str(media_id),
                    str(limit),
                ],
                capture_output=True,
                text=True,
                timeout=120,
                env={**os.environ, "KMP_DUPLICATE_LIB_OK": "TRUE"},
            )
            if proc.returncode != 0:
                logger.warning(
                    "FAISS subprocess failed (exit %s): %s",
                    proc.returncode,
                    proc.stderr.strip(),
                )
                return self._similar_fallback(media_id, limit)
            return json.loads(proc.stdout)
        except Exception as exc:
            logger.warning("FAISS subprocess error: %s", exc)
            return self._similar_fallback(media_id, limit)

    def _similar_fallback(self, media_id: int, limit: int) -> list[dict[str, Any]]:
        """Metadata fallback when FAISS is unavailable."""
        with self.db.connect() as conn:
            source = conn.execute(
                "SELECT scene_tags, album, year FROM media WHERE id = ?",
                (media_id,),
            ).fetchone()
            if not source:
                return []
            clauses = ["m.id != ?"]
            params: list[Any] = [media_id]
            if source["scene_tags"]:
                clauses.append("m.scene_tags = ?")
                params.append(source["scene_tags"])
            elif source["album"]:
                clauses.append("m.album = ?")
                params.append(source["album"])
            elif source["year"]:
                clauses.append("m.year = ?")
                params.append(source["year"])
            else:
                return []
            rows = conn.execute(
                f"""
                SELECT m.* FROM media m
                WHERE {' AND '.join(clauses)}
                ORDER BY m.taken_at DESC
                LIMIT ?
                """,
                (*params, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def _faiss_search(self, text: str, limit: int) -> list[dict[str, Any]]:
        from memory_engine.vision.pipeline import VisionPipeline

        index, _ = VisionPipeline.load_index(self.config)
        if index is None or index.ntotal == 0:
            return []
        try:
            model, tokenizer, device = self._clip_model()
            import torch

            tokens = tokenizer([text]).to(device)
            with torch.no_grad():
                text_feat = model.encode_text(tokens)
                text_feat = text_feat / text_feat.norm(dim=-1, keepdim=True)
            text_vec = text_feat.cpu().numpy().astype(np.float32)
            scores, idxs = index.search(text_vec, min(limit, index.ntotal))
        except Exception:
            return []

        results: list[dict[str, Any]] = []
        with self.db.connect() as conn:
            for score, idx in zip(scores[0], idxs[0]):
                if idx < 0:
                    continue
                row = conn.execute(
                    """
                    SELECT m.* FROM embeddings e
                    JOIN media m ON m.id = e.media_id
                    WHERE e.faiss_id = ?
                    """,
                    (int(idx),),
                ).fetchone()
                if row:
                    item = dict(row)
                    item["score"] = float(score)
                    results.append(item)
        return results
