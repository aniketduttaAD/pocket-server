from __future__ import annotations

import os

# Avoid OpenMP abort when FAISS/PyTorch and other libs both link libomp (common on macOS).
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import asyncio
import json
import logging
import mimetypes
from pathlib import Path
from typing import Any

from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from memory_engine.core.config import load_config
from memory_engine.core.db import Database
from memory_engine.core.pipeline import PipelineRunner, STAGES
from memory_engine.core.watcher import IncrementalWatcher
from memory_engine.rag.recap import PhotoRAG
from memory_engine.search.hybrid import HybridSearch
from memory_engine.timeline.summary import build_event_summary, build_year_recap

logger = logging.getLogger(__name__)

config = load_config()
config.ensure_dirs()
db = Database(config.db_path)
db.init_schema()
runner = PipelineRunner(config, db)
watcher: IncrementalWatcher | None = None

progress_clients: list[WebSocket] = []


def _broadcast_progress(stage: str, completed: int, total: int, message: str = "") -> None:
    payload = {
        "stage": stage,
        "completed": completed,
        "total": total,
        "message": message,
    }
    for ws in list(progress_clients):
        try:
            asyncio.create_task(ws.send_json(payload))
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    runner.set_progress_callback(_broadcast_progress)
    yield


app = FastAPI(title="Memory Engine", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchRequest(BaseModel):
    query: str
    limit: int = 40


class ChatRequest(BaseModel):
    question: str


class IngestRequest(BaseModel):
    full: bool = False
    stages: list[str] | None = None


class PersonUpdateRequest(BaseModel):
    name: str


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "0.1.0"}


@app.get("/api/llm/status")
def llm_status_endpoint() -> dict[str, Any]:
    from memory_engine.rag.local_llm import llm_status

    return llm_status(config)


@app.get("/api/status")
def status() -> dict[str, Any]:
    return {
        "stats": db.stats(),
        "photos_root": str(config.photos_root),
        "data_dir": str(config.data_dir),
        "stages": STAGES,
        "jobs": runner.latest_jobs(10),
    }


@app.get("/api/analytics")
def analytics() -> dict[str, Any]:
    with db.connect() as conn:
        by_year = conn.execute(
            """
            SELECT year, COUNT(*) AS count
            FROM media WHERE year IS NOT NULL
            GROUP BY year ORDER BY year
            """
        ).fetchall()
        top_people = conn.execute(
            "SELECT name, photo_count FROM people ORDER BY photo_count DESC LIMIT 15"
        ).fetchall()
        top_places = conn.execute(
            "SELECT name, media_count FROM places ORDER BY media_count DESC LIMIT 15"
        ).fetchall()
        by_type = conn.execute(
            "SELECT media_type, COUNT(*) AS count FROM media GROUP BY media_type"
        ).fetchall()
    return {
        "by_year": [dict(r) for r in by_year],
        "top_people": [dict(r) for r in top_people],
        "top_places": [dict(r) for r in top_places],
        "by_type": [dict(r) for r in by_type],
    }


@app.post("/api/ingest")
def ingest(req: IngestRequest) -> dict[str, Any]:
    stages = req.stages or STAGES
    results = runner.run_all(full=req.full, stages=stages)
    return {"ok": True, "results": results}


@app.post("/api/search")
def search(req: SearchRequest) -> dict[str, Any]:
    results = HybridSearch(config, db).search(req.query, limit=req.limit)
    return {"query": req.query, "results": results, "count": len(results)}


@app.post("/api/chat")
def chat(req: ChatRequest) -> dict[str, Any]:
    return PhotoRAG(config, db).chat(req.question)


@app.get("/api/media/{media_id}")
def get_media(media_id: int) -> dict[str, Any]:
    with db.connect() as conn:
        media = conn.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone()
        if not media:
            return {"error": "not found"}
        people = conn.execute(
            """
            SELECT p.* FROM people p
            JOIN media_people mp ON mp.person_id = p.id
            WHERE mp.media_id = ?
            """,
            (media_id,),
        ).fetchall()
        places = conn.execute(
            """
            SELECT pl.* FROM places pl
            JOIN media_places mp ON mp.place_id = pl.id
            WHERE mp.media_id = ?
            """,
            (media_id,),
        ).fetchall()
        transcript = conn.execute(
            "SELECT * FROM transcripts WHERE media_id = ?",
            (media_id,),
        ).fetchone()
        duplicates = conn.execute(
            """
            SELECT m.* FROM media m
            JOIN media_duplicates md ON md.media_id = m.id
            WHERE md.group_id IN (
                SELECT group_id FROM media_duplicates WHERE media_id = ?
            ) AND m.id != ?
            """,
            (media_id, media_id),
        ).fetchall()
    return {
        "media": dict(media),
        "people": [dict(p) for p in people],
        "places": [dict(p) for p in places],
        "transcript": dict(transcript) if transcript else None,
        "duplicates": [dict(d) for d in duplicates],
    }


@app.get("/api/people")
def list_people(min_photos: int = 1, include_unknown: bool = False) -> list[dict[str, Any]]:
    clauses = ["photo_count >= ?"]
    params: list[Any] = [min_photos]
    if not include_unknown:
        clauses.append("name NOT LIKE 'Unknown Person%'")
    with db.connect() as conn:
        rows = conn.execute(
            f"""
            SELECT * FROM people
            WHERE {' AND '.join(clauses)}
            ORDER BY photo_count DESC, name ASC
            """,
            params,
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/people/{person_id}/media")
def person_media(person_id: int, limit: int = 60) -> list[dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT m.* FROM media m
            JOIN media_people mp ON mp.media_id = m.id
            WHERE mp.person_id = ?
            ORDER BY m.taken_at DESC
            LIMIT ?
            """,
            (person_id, limit),
        ).fetchall()
        if not rows:
            rows = conn.execute(
                """
                SELECT DISTINCT m.* FROM media m
                JOIN faces f ON f.media_id = m.id
                WHERE f.person_id = ?
                ORDER BY m.taken_at DESC
                LIMIT ?
                """,
                (person_id, limit),
            ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/places")
def list_places() -> list[dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM places ORDER BY media_count DESC, name ASC"
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/places/{place_id}/media")
def place_media(place_id: int, limit: int = 60) -> list[dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT m.* FROM media m
            JOIN media_places mp ON mp.media_id = m.id
            WHERE mp.place_id = ?
            ORDER BY m.taken_at DESC
            LIMIT ?
            """,
            (place_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/trips")
def list_trips() -> list[dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM trips ORDER BY start_at DESC").fetchall()
    return [dict(r) for r in rows]


@app.get("/api/events")
def list_events(year: int | None = None, limit: int = 100) -> list[dict[str, Any]]:
    with db.connect() as conn:
        if year is not None:
            rows = conn.execute(
                """
                SELECT * FROM events
                WHERE strftime('%Y', start_at) = ?
                ORDER BY start_at DESC
                LIMIT ?
                """,
                (str(year), limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM events ORDER BY start_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/events/{event_id}/media")
def event_media(event_id: int, limit: int = 120) -> list[dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT m.* FROM media m
            JOIN media_events me ON me.media_id = m.id
            WHERE me.event_id = ?
            ORDER BY m.taken_at ASC, m.rel_path ASC
            LIMIT ?
            """,
            (event_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/timeline/{year}")
def timeline_year(year: int) -> dict[str, Any]:
    with db.connect() as conn:
        media = conn.execute(
            "SELECT * FROM media WHERE year = ? ORDER BY taken_at ASC, rel_path ASC",
            (year,),
        ).fetchall()
        event_rows = conn.execute(
            """
            SELECT * FROM events
            WHERE strftime('%Y', start_at) = ?
            ORDER BY start_at DESC
            """,
            (str(year),),
        ).fetchall()
        ungrouped = conn.execute(
            """
            SELECT m.* FROM media m
            WHERE m.year = ?
            AND m.id NOT IN (SELECT media_id FROM media_events)
            ORDER BY m.taken_at DESC, m.rel_path DESC
            """,
            (year,),
        ).fetchall()

    media_list = [dict(m) for m in media]
    images = sum(1 for m in media_list if m["media_type"] == "image")
    videos = sum(1 for m in media_list if m["media_type"] == "video")
    events = [build_event_summary(db, int(row["id"])) for row in event_rows]

    return {
        "year": year,
        "stats": {
            "total": len(media_list),
            "images": images,
            "videos": videos,
            "events": len(events),
            "ungrouped": len(ungrouped),
        },
        "recap": build_year_recap(config, db, year),
        "events": events,
        "ungrouped_media": [dict(m) for m in ungrouped],
        "highlights": media_list[-24:][::-1],
    }


@app.get("/api/wardrobe")
def wardrobe(limit: int = 100) -> list[dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM media
            WHERE album = 'Wardrobe'
            ORDER BY taken_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/on-this-day")
def on_this_day(month: int, day: int) -> dict[str, Any]:
    date_key = f"{month:02d}-{day:02d}"
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM media
            WHERE strftime('%m-%d', taken_at) = ?
            ORDER BY year DESC, taken_at DESC
            """,
            (date_key,),
        ).fetchall()
    by_year: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        item = dict(row)
        year = item.get("year") or 0
        by_year.setdefault(year, []).append(item)
    return {
        "month": month,
        "day": day,
        "total": len(rows),
        "by_year": {str(y): items for y, items in sorted(by_year.items(), reverse=True)},
        "memories": [dict(r) for r in rows],
    }


@app.get("/api/media/{media_id}/similar")
def similar_media(media_id: int, limit: int = 24) -> dict[str, Any]:
    try:
        results = HybridSearch(config, db).find_similar(media_id, limit=limit)
    except Exception as exc:
        logger.warning("Similar media search failed for %s: %s", media_id, exc)
        results = []
    return {"media_id": media_id, "results": results, "count": len(results)}


@app.get("/api/media/{media_id}/faces")
def media_faces(media_id: int) -> dict[str, Any]:
    with db.connect() as conn:
        media = conn.execute(
            "SELECT width, height FROM media WHERE id = ?",
            (media_id,),
        ).fetchone()
        width = float(media["width"]) if media and media["width"] else 1.0
        height = float(media["height"]) if media and media["height"] else 1.0
        rows = conn.execute(
            """
            SELECT f.id, f.media_id, f.cluster_id, f.person_id,
                   f.bbox_x, f.bbox_y, f.bbox_w, f.bbox_h, f.confidence,
                   p.name AS person_name
            FROM faces f
            LEFT JOIN people p ON p.id = f.person_id
            WHERE f.media_id = ?
            """,
            (media_id,),
        ).fetchall()

    faces = []
    for row in rows:
        item = dict(row)
        item["bbox_x"] = item["bbox_x"] / width
        item["bbox_y"] = item["bbox_y"] / height
        item["bbox_w"] = item["bbox_w"] / width
        item["bbox_h"] = item["bbox_h"] / height
        faces.append(item)
    return {"faces": faces}


@app.get("/api/scene-albums")
def scene_albums() -> list[dict[str, Any]]:
    import json as json_mod

    tag_counts: dict[str, int] = {}
    tag_cover: dict[str, int] = {}
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, scene_tags FROM media WHERE scene_tags IS NOT NULL AND scene_tags != ''"
        ).fetchall()
    for row in rows:
        try:
            tags = json_mod.loads(row["scene_tags"])
            if isinstance(tags, str):
                tags = [tags]
        except (json_mod.JSONDecodeError, TypeError):
            tags = [row["scene_tags"]] if row["scene_tags"] else []
        for tag in tags:
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
            if tag not in tag_cover:
                tag_cover[tag] = int(row["id"])
    return [
        {"tag": tag, "count": count, "cover_id": tag_cover.get(tag)}
        for tag, count in sorted(tag_counts.items(), key=lambda x: -x[1])
    ]


@app.get("/api/transcripts/search")
def search_transcripts(q: str, limit: int = 40) -> list[dict[str, Any]]:
    if not q.strip():
        return []
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT m.*, t.text AS transcript_text, t.segments
            FROM transcripts_fts f
            JOIN transcripts t ON t.media_id = f.rowid
            JOIN media m ON m.id = t.media_id
            WHERE transcripts_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (q, limit),
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/duplicates")
def list_duplicates(limit: int = 100) -> list[dict[str, Any]]:
    with db.connect() as conn:
        groups = conn.execute(
            """
            SELECT dg.*, m.id AS rep_id, m.rel_path AS rep_path, m.taken_at AS rep_taken_at
            FROM duplicate_groups dg
            LEFT JOIN media m ON m.id = dg.representative_media_id
            ORDER BY dg.member_count DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    result = []
    for g in groups:
        item = dict(g)
        if g["rep_id"]:
            item["representative"] = {
                "id": g["rep_id"],
                "rel_path": g["rep_path"],
                "taken_at": g["rep_taken_at"],
            }
        result.append(item)
    return result


@app.get("/api/people/{person_id}/timeline")
def person_timeline(person_id: int) -> dict[str, Any]:
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT m.* FROM media m
            JOIN media_people mp ON mp.media_id = m.id
            WHERE mp.person_id = ?
            ORDER BY m.taken_at ASC
            """,
            (person_id,),
        ).fetchall()
        if not rows:
            rows = conn.execute(
                """
                SELECT DISTINCT m.* FROM media m
                JOIN faces f ON f.media_id = m.id
                WHERE f.person_id = ?
                ORDER BY m.taken_at ASC
                """,
                (person_id,),
            ).fetchall()
    by_year: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        item = dict(row)
        year = str(item.get("year") or "unknown")
        by_year.setdefault(year, []).append(item)
    return {"person_id": person_id, "by_year": by_year, "total": len(rows)}


@app.get("/api/people/cooccurrence")
def people_cooccurrence(person_id: int, limit: int = 10) -> list[dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT p.id, p.name, p.display_name, COUNT(*) AS count
            FROM media_people mp1
            JOIN media_people mp2 ON mp1.media_id = mp2.media_id
            JOIN people p ON p.id = mp2.person_id
            WHERE mp1.person_id = ? AND mp2.person_id != ?
            GROUP BY p.id
            ORDER BY count DESC
            LIMIT ?
            """,
            (person_id, person_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


@app.patch("/api/people/{person_id}")
def update_person(person_id: int, req: PersonUpdateRequest) -> dict[str, Any]:
    with db.connect() as conn:
        conn.execute(
            "UPDATE people SET name = ?, display_name = ?, confirmed = 1 WHERE id = ?",
            (req.name, req.name, person_id),
        )
        conn.execute(
            "UPDATE face_clusters SET confirmed = 1, label = ? WHERE person_id = ?",
            (req.name, person_id),
        )
        row = conn.execute("SELECT * FROM people WHERE id = ?", (person_id,)).fetchone()
    return {"ok": True, "person": dict(row) if row else None}


@app.get("/api/trips/{trip_id}")
def trip_detail(trip_id: int) -> dict[str, Any]:
    with db.connect() as conn:
        trip = conn.execute("SELECT * FROM trips WHERE id = ?", (trip_id,)).fetchone()
        if not trip:
            return {"error": "not found"}
        place = None
        if trip["place_id"]:
            place = conn.execute("SELECT * FROM places WHERE id = ?", (trip["place_id"],)).fetchone()
        media_rows = conn.execute(
            """
            SELECT m.* FROM media m
            JOIN media_trips mt ON mt.media_id = m.id
            WHERE mt.trip_id = ?
            ORDER BY m.taken_at ASC
            """,
            (trip_id,),
        ).fetchall()
    result = dict(trip)
    result["place"] = dict(place) if place else None
    result["media"] = [dict(r) for r in media_rows]
    return result


def _resolve_media_path(abs_path: str | None, rel_path: str | None) -> Path | None:
    """Prefer photos_root/rel_path so renames of the library folder keep working."""
    if rel_path:
        candidate = (config.photos_root / rel_path).resolve()
        if candidate.exists():
            return candidate
    if abs_path:
        candidate = Path(abs_path)
        if candidate.exists():
            return candidate
    return None


@app.get("/api/media/file/{media_id}")
def media_file(media_id: int):
    with db.connect() as conn:
        row = conn.execute(
            "SELECT abs_path, rel_path, media_type FROM media WHERE id = ?",
            (media_id,),
        ).fetchone()
    if not row:
        return {"error": "not found"}
    path = _resolve_media_path(row["abs_path"], row["rel_path"])
    if path is None:
        return {"error": "file missing"}
    mime, _ = mimetypes.guess_type(path.name)
    return FileResponse(path, media_type=mime or "application/octet-stream")


@app.post("/api/watch/start")
def watch_start() -> dict[str, str]:
    global watcher
    if watcher is None:
        watcher = IncrementalWatcher(config, db)
        watcher.start()
    return {"status": "watching"}


@app.post("/api/watch/stop")
def watch_stop() -> dict[str, str]:
    global watcher
    if watcher is not None:
        watcher.stop()
        watcher = None
    return {"status": "stopped"}


@app.websocket("/ws/progress")
async def ws_progress(websocket: WebSocket) -> None:
    await websocket.accept()
    progress_clients.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in progress_clients:
            progress_clients.remove(websocket)


WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
