from __future__ import annotations

import json
import logging
import math
import time
from datetime import datetime, timedelta
from typing import Any, Callable

import numpy as np
from sklearn.cluster import DBSCAN

from memory_engine.core.config import EngineConfig
from memory_engine.core.db import Database

logger = logging.getLogger(__name__)
Progress = Callable[[str, int, int, str], None]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


class GeoPipeline:
    def __init__(self, config: EngineConfig, db: Database) -> None:
        self.config = config
        self.db = db

    def run(self, progress: Progress | None = None) -> dict[str, Any]:
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT id, latitude, longitude, taken_at
                FROM media
                WHERE latitude IS NOT NULL AND longitude IS NOT NULL
                ORDER BY taken_at
                """
            ).fetchall()

        total = len(rows)
        if not rows:
            return {"total": 0, "completed": 0, "places": 0, "trips": 0}

        coords = np.array([[r["latitude"], r["longitude"]] for r in rows], dtype=float)
        eps_deg = self.config.geo_eps_km / 111.0
        labels = DBSCAN(eps=eps_deg, min_samples=2, metric="euclidean").fit_predict(coords)

        with self.db.connect() as conn:
            conn.execute("DELETE FROM media_places")
            conn.execute("DELETE FROM media_trips")
            conn.execute("DELETE FROM trips")
            conn.execute("DELETE FROM places")

        place_ids: dict[int, int] = {}
        completed = 0
        for label in sorted(set(labels)):
            if label == -1:
                continue
            indices = [i for i, lb in enumerate(labels) if lb == label]
            cluster_rows = [rows[i] for i in indices]
            lat = float(np.mean([r["latitude"] for r in cluster_rows]))
            lon = float(np.mean([r["longitude"] for r in cluster_rows]))
            geocode_name = self._reverse_geocode(lat, lon)
            name = geocode_name or f"Place {label + 1}"
            with self.db.connect() as conn:
                cur = conn.execute(
                    """
                    INSERT INTO places(name, latitude, longitude, cluster_id, geocode_name, media_count)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (name, lat, lon, int(label), geocode_name, len(indices)),
                )
                place_id = int(cur.lastrowid)
                place_ids[int(label)] = place_id
                for idx in indices:
                    media_id = int(rows[idx]["id"])
                    conn.execute(
                        "INSERT OR IGNORE INTO media_places(media_id, place_id) VALUES (?, ?)",
                        (media_id, place_id),
                    )
            completed += len(indices)
            if progress:
                progress("geo", completed, total, name)

        self._detect_home(place_ids, rows, labels)
        trips = self._detect_trips(rows, labels, place_ids)
        noise_linked = self._link_noise_points(rows, labels, place_ids)
        completed = total
        if progress:
            progress("geo", completed, total, "done")
        return {
            "total": total,
            "completed": completed,
            "places": len(place_ids),
            "trips": trips,
            "noise_linked": noise_linked,
        }

    def _reverse_geocode(self, lat: float, lon: float) -> str | None:
        lat_key = f"{lat:.4f}"
        lon_key = f"{lon:.4f}"
        with self.db.connect() as conn:
            cached = conn.execute(
                "SELECT display_name FROM geocode_cache WHERE lat_key = ? AND lon_key = ?",
                (lat_key, lon_key),
            ).fetchone()
            if cached:
                return cached["display_name"]

        display_name = None
        try:
            import httpx

            url = "https://nominatim.openstreetmap.org/reverse"
            params = {"lat": lat, "lon": lon, "format": "json", "zoom": 14}
            headers = {"User-Agent": "MemoryEngine/0.1 (local personal use)"}
            with httpx.Client(timeout=10.0) as client:
                resp = client.get(url, params=params, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    display_name = data.get("display_name")
                    with self.db.connect() as conn:
                        conn.execute(
                            """
                            INSERT OR REPLACE INTO geocode_cache(lat_key, lon_key, display_name, raw_json)
                            VALUES (?, ?, ?, ?)
                            """,
                            (lat_key, lon_key, display_name, json.dumps(data)),
                        )
            time.sleep(1.0)
        except Exception as exc:
            logger.debug("Geocode failed for %s,%s: %s", lat, lon, exc)
        return display_name

    def _detect_home(self, place_ids: dict[int, int], rows, labels) -> None:
        if not place_ids:
            return
        counts: dict[int, int] = {}
        for i, label in enumerate(labels):
            if label == -1:
                continue
            counts[int(label)] = counts.get(int(label), 0) + 1
        if not counts:
            return
        home_label = max(counts, key=counts.get)
        home_place_id = place_ids.get(home_label)
        if home_place_id:
            with self.db.connect() as conn:
                conn.execute("UPDATE places SET is_home = 0")
                conn.execute(
                    "UPDATE places SET is_home = 1, name = COALESCE(NULLIF(name, ''), 'Home') WHERE id = ?",
                    (home_place_id,),
                )

    def _link_noise_points(self, rows, labels, place_ids: dict[int, int]) -> int:
        if not place_ids:
            return 0
        with self.db.connect() as conn:
            place_rows = conn.execute("SELECT id, latitude, longitude FROM places").fetchall()
        linked = 0
        for i, label in enumerate(labels):
            if label != -1:
                continue
            lat, lon = float(rows[i]["latitude"]), float(rows[i]["longitude"])
            best_id = None
            best_dist = float("inf")
            for p in place_rows:
                d = haversine_km(lat, lon, float(p["latitude"]), float(p["longitude"]))
                if d < best_dist:
                    best_dist = d
                    best_id = int(p["id"])
            if best_id is not None and best_dist <= self.config.geo_eps_km * 3:
                with self.db.connect() as conn:
                    conn.execute(
                        "INSERT OR IGNORE INTO media_places(media_id, place_id) VALUES (?, ?)",
                        (int(rows[i]["id"]), best_id),
                    )
                linked += 1
        return linked

    def _detect_trips(self, rows, labels, place_ids: dict[int, int]) -> int:
        with self.db.connect() as conn:
            home = conn.execute("SELECT id, latitude, longitude FROM places WHERE is_home = 1").fetchone()
        home_id = int(home["id"]) if home else None
        home_lat = float(home["latitude"]) if home else None
        home_lon = float(home["longitude"]) if home else None

        by_place: dict[int, list] = {}
        for i, row in enumerate(rows):
            label = int(labels[i])
            if label == -1:
                continue
            place_id = place_ids.get(label)
            if not place_id:
                continue
            if home_id and place_id == home_id:
                continue
            if home_lat is not None and haversine_km(
                float(row["latitude"]), float(row["longitude"]), home_lat, home_lon
            ) < self.config.home_radius_km:
                continue
            by_place.setdefault(place_id, []).append(row)

        trip_count = 0
        for place_id, items in by_place.items():
            if len(items) < self.config.trip_min_photos:
                continue
            items.sort(key=lambda r: r["taken_at"] or "")
            start = datetime.fromisoformat(items[0]["taken_at"]) if items[0]["taken_at"] else None
            end = datetime.fromisoformat(items[-1]["taken_at"]) if items[-1]["taken_at"] else None
            if start and end and (end - start).days > self.config.trip_max_days:
                continue
            with self.db.connect() as conn:
                place = conn.execute("SELECT name FROM places WHERE id = ?", (place_id,)).fetchone()
                trip_name = f"Trip to {place['name']}" if place else f"Trip {place_id}"
                cur = conn.execute(
                    """
                    INSERT INTO trips(name, place_id, start_at, end_at, media_count)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        trip_name,
                        place_id,
                        items[0]["taken_at"],
                        items[-1]["taken_at"],
                        len(items),
                    ),
                )
                trip_id = int(cur.lastrowid)
                for item in items:
                    conn.execute(
                        "INSERT OR IGNORE INTO media_trips(media_id, trip_id) VALUES (?, ?)",
                        (int(item["id"]), trip_id),
                    )
            trip_count += 1
        return trip_count
