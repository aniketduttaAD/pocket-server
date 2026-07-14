from __future__ import annotations

from collections import Counter
from typing import Any

from memory_engine.catalog.exif import parse_date_from_path
from memory_engine.core.config import EngineConfig
from memory_engine.core.db import Database


def media_display_date(media: dict[str, Any]) -> str | None:
    taken = media.get("taken_at")
    if taken:
        return taken[:10]
    parsed = parse_date_from_path(media.get("rel_path") or "")
    return parsed.strftime("%Y-%m-%d") if parsed else None


def _named_people(conn, media_id: int) -> list[str]:
    rows = conn.execute(
        """
        SELECT p.name FROM people p
        JOIN media_people mp ON mp.person_id = p.id
        WHERE mp.media_id = ? AND p.name NOT LIKE 'Unknown Person%'
        ORDER BY p.name
        """,
        (media_id,),
    ).fetchall()
    return [row["name"] for row in rows]


def _short_place(label: str | None) -> str | None:
    if not label:
        return None
    return label.split(",")[0].strip()


def _place_name(conn, media_id: int) -> str | None:
    row = conn.execute(
        """
        SELECT COALESCE(pl.name, pl.geocode_name) AS label
        FROM places pl
        JOIN media_places mp ON mp.place_id = pl.id
        WHERE mp.media_id = ?
        LIMIT 1
        """,
        (media_id,),
    ).fetchone()
    return _short_place(row["label"]) if row and row["label"] else None


def build_year_recap(config: EngineConfig, db: Database, year: int) -> str:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, media_type, taken_at, rel_path FROM media WHERE year = ?",
            (year,),
        ).fetchall()
        if not rows:
            return f"No memories indexed for {year} yet."

        images = sum(1 for row in rows if row["media_type"] == "image")
        videos = sum(1 for row in rows if row["media_type"] == "video")

        people: Counter[str] = Counter()
        places: Counter[str] = Counter()
        months: Counter[str] = Counter()

        for row in rows:
            media_id = int(row["id"])
            for name in _named_people(conn, media_id):
                people[name] += 1
            place = _place_name(conn, media_id)
            if place:
                places[place] += 1
            date = media_display_date(dict(row))
            if date:
                months[date[:7]] += 1

        event_count = conn.execute(
            """
            SELECT COUNT(*) AS c FROM events
            WHERE strftime('%Y', start_at) = ?
            """,
            (str(year),),
        ).fetchone()["c"]

    lines = [f"{year} in your library: {images:,} photos and {videos:,} videos across {event_count} events."]

    if people:
        top = ", ".join(name for name, _ in people.most_common(5))
        lines.append(f"Most photographed people: {top}.")

    if places:
        top = ", ".join(name for name, _ in places.most_common(3))
        lines.append(f"Places you captured: {top}.")

    if months:
        busiest = months.most_common(1)[0][0]
        lines.append(f"Busiest month: {busiest} ({months[busiest]:,} items).")

    if videos and images == 0:
        lines.append("Mostly video memories this year.")
    elif videos == 0:
        lines.append("All photo memories this year.")

    return " ".join(lines)


def summarize_media_group(db: Database, media_rows: list[Any]) -> str:
    people: Counter[str] = Counter()
    places: Counter[str] = Counter()
    images = 0
    videos = 0

    with db.connect() as conn:
        for row in media_rows:
            media_id = int(row["id"])
            if row["media_type"] == "image":
                images += 1
            else:
                videos += 1
            for name in _named_people(conn, media_id):
                people[name] += 1
            place = _place_name(conn, media_id)
            if place:
                places[place] += 1

    parts = [f"{len(media_rows)} memories"]
    if images and videos:
        parts.append(f"{images} photos, {videos} videos")
    elif videos:
        parts.append(f"{videos} videos")
    who = ", ".join(name for name, _ in people.most_common(4))
    if who:
        parts.append(f"with {who}")
    where = places.most_common(1)[0][0] if places else None
    if where:
        parts.append(f"at {where}")
    return " · ".join(parts)


def build_event_summary(db: Database, event_id: int, limit: int = 8) -> dict[str, Any]:
    with db.connect() as conn:
        event = conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
        if not event:
            return {}
        media_rows = conn.execute(
            """
            SELECT m.* FROM media m
            JOIN media_events me ON me.media_id = m.id
            WHERE me.event_id = ?
            ORDER BY m.taken_at ASC, m.rel_path ASC
            """,
            (event_id,),
        ).fetchall()

    people: Counter[str] = Counter()
    places: Counter[str] = Counter()

    with db.connect() as conn:
        for row in media_rows:
            media_id = int(row["id"])
            for name in _named_people(conn, media_id):
                people[name] += 1
            place = _place_name(conn, media_id)
            if place:
                places[place] += 1

    day = (event["start_at"] or "")[:10]
    where = places.most_common(1)[0][0] if places else None

    return {
        "id": int(event["id"]),
        "name": event["name"],
        "day": day,
        "start_at": event["start_at"],
        "end_at": event["end_at"],
        "media_count": len(media_rows),
        "summary": summarize_media_group(db, media_rows),
        "people": [name for name, _ in people.most_common(6)],
        "place": where,
        "sample_media": [dict(row) for row in media_rows[:limit]],
    }
