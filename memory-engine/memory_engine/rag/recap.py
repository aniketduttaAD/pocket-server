from __future__ import annotations

import logging
from typing import Any

from memory_engine.core.config import EngineConfig
from memory_engine.core.db import Database
from memory_engine.rag.local_llm import generate as local_generate
from memory_engine.search.hybrid import HybridSearch
from memory_engine.timeline.summary import build_year_recap, summarize_media_group

logger = logging.getLogger(__name__)


def generate_recap(
    config: EngineConfig,
    db: Database,
    media_rows: list[Any],
    title: str = "Memory Recap",
) -> str:
    if title.startswith("Year "):
        try:
            year = int(title.split()[-1])
            return build_year_recap(config, db, year)
        except ValueError:
            pass

    if media_rows:
        return summarize_media_group(db, media_rows)

    return f"No memories found for {title}."


def _place_names_for_media(db: Database, media_id: int) -> str:
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT COALESCE(pl.geocode_name, pl.name) AS label
            FROM places pl
            JOIN media_places mp ON mp.place_id = pl.id
            WHERE mp.media_id = ?
            """,
            (media_id,),
        ).fetchall()
    if not rows:
        return ""
    return ", ".join(r["label"].split(",")[0].strip() for r in rows if r["label"])


def _format_local_answer(question: str, results: list[dict[str, Any]], db: Database) -> str:
    if not results:
        return (
            f"I couldn't find any memories matching \"{question}\". "
            "Try a person name, year, place, or scene like food or selfie."
        )

    lines = [f"Found {len(results)} memories for \"{question}\":\n"]
    for item in results[:12]:
        with db.connect() as conn:
            people = conn.execute(
                """
                SELECT p.name FROM people p
                JOIN media_people mp ON mp.person_id = p.id
                WHERE mp.media_id = ? AND p.name NOT LIKE 'Unknown Person%'
                """,
                (item["id"],),
            ).fetchall()
        who = ", ".join(p["name"] for p in people) if people else "no one tagged"
        place = _place_names_for_media(db, int(item["id"]))
        where = f" at {place}" if place else ""
        taken = (item.get("taken_at") or "unknown date")[:10]
        media_type = item.get("media_type", "photo")
        tags = (item.get("scene_tags") or "").replace('"', "")
        tag_hint = f" [{tags}]" if tags else ""
        lines.append(f"- {taken}{where} — {who} ({media_type}){tag_hint}")

    return "\n".join(lines)


class PhotoRAG:
    def __init__(self, config: EngineConfig, db: Database) -> None:
        self.config = config
        self.db = db
        self.search = HybridSearch(config, db)

    def chat(self, question: str) -> dict[str, Any]:
        results = self.search.search(question, limit=12)
        context_lines = []
        media_ids = []
        for item in results:
            media_ids.append(int(item["id"]))
            with self.db.connect() as conn:
                people = conn.execute(
                    """
                    SELECT p.name FROM people p
                    JOIN media_people mp ON mp.person_id = p.id
                    WHERE mp.media_id = ? AND p.name NOT LIKE 'Unknown Person%'
                    """,
                    (item["id"],),
                ).fetchall()
                transcript = conn.execute(
                    "SELECT text FROM transcripts WHERE media_id = ?",
                    (item["id"],),
                ).fetchone()
            who = ", ".join(p["name"] for p in people)
            place = _place_names_for_media(self.db, int(item["id"]))
            line = (
                f"Photo {item['id']}: {item.get('taken_at')} | people: {who} | "
                f"place: {place or 'unknown'} | path: {item['rel_path']} | tags: {item.get('scene_tags')}"
            )
            if transcript and transcript["text"]:
                line += f" | transcript: {transcript['text'][:200]}"
            context_lines.append(line)

        context = "\n".join(context_lines) or "No matching media found."
        answer = self._ask_llm(question, context, results)
        return {"answer": answer, "media_ids": media_ids, "media": results}

    def _ask_llm(
        self, question: str, context: str, results: list[dict[str, Any]]
    ) -> str:
        if not results:
            return _format_local_answer(question, results, self.db)

        user_prompt = (
            f"Question: {question}\n\n"
            f"Retrieved photo memories (these ARE the matching photos — describe them):\n{context}\n\n"
            "Summarize these memories in a friendly way. Do not say nothing was found."
        )

        if self.config.local_llm_enabled:
            text = local_generate(self.config, user_prompt)
            if text:
                return text

        return _format_local_answer(question, results, self.db)
