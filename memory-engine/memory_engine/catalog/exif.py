from __future__ import annotations

import json
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any

EXIFTOOL = shutil.which("exiftool")
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"}
VIDEO_EXT = {".mp4", ".mov", ".avi", ".mkv", ".3gpp"}


def parse_exif_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value.strip(), fmt)
        except ValueError:
            continue
    return None


def parse_date_from_path(path: str | Path) -> datetime | None:
    """Parse capture time from organized filenames like 20230209_050550_*.mp4."""
    text = str(path)
    match = re.search(r"(?:^|/)(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})", text)
    if not match:
        return None
    year, month, day, hour, minute, second = (int(part) for part in match.groups())
    try:
        return datetime(year, month, day, hour, minute, second)
    except ValueError:
        return None


def dms_to_decimal(dms: str, ref: str) -> float | None:
    if not dms:
        return None
    parts = [float(p) for p in re.findall(r"[\d.]+", dms)]
    if len(parts) < 3:
        return None
    deg, minutes, seconds = parts[0], parts[1], parts[2]
    decimal = deg + minutes / 60 + seconds / 3600
    if ref in ("S", "W"):
        decimal = -decimal
    return decimal


def parse_keywords(keywords: str | None) -> list[str]:
    if not keywords:
        return []
    return [k.strip() for k in keywords.split(",") if k.strip() and not k.strip().startswith("Album:")]


def parse_album_from_keywords(keywords: str | None) -> str | None:
    if not keywords:
        return None
    for part in keywords.split(","):
        part = part.strip()
        if part.startswith("Album:"):
            return part.replace("Album:", "", 1).strip()
    return None


def detect_album_from_path(rel_path: str) -> str | None:
    parts = Path(rel_path).parts
    for name in ("Wardrobe", "Failed"):
        if name in parts:
            return name
    return None


def extract_metadata(path: Path) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "rel_path": None,
        "media_type": None,
        "taken_at": None,
        "year": None,
        "album": None,
        "keywords": None,
        "description": None,
        "user_comment": None,
        "latitude": None,
        "longitude": None,
        "width": None,
        "height": None,
        "duration_sec": None,
        "file_size": path.stat().st_size,
    }
    suffix = path.suffix.lower()
    if suffix in IMAGE_EXT:
        meta["media_type"] = "image"
    elif suffix in VIDEO_EXT:
        meta["media_type"] = "video"
    else:
        return meta

    if EXIFTOOL:
        result = subprocess.run(
            [
                EXIFTOOL,
                "-DateTimeOriginal",
                "-CreateDate",
                "-Keywords",
                "-Subject",
                "-ImageDescription",
                "-Description",
                "-UserComment",
                "-GPSLatitude",
                "-GPSLatitudeRef",
                "-GPSLongitude",
                "-GPSLongitudeRef",
                "-ImageWidth",
                "-ImageHeight",
                "-Duration",
                "-json",
                str(path),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and result.stdout.strip():
            data = json.loads(result.stdout)[0]
            taken = parse_exif_datetime(
                data.get("DateTimeOriginal") or data.get("CreateDate")
            )
            if taken:
                meta["taken_at"] = taken.isoformat()
                meta["year"] = taken.year

            meta["keywords"] = data.get("Keywords") or data.get("Subject")
            meta["description"] = data.get("ImageDescription") or data.get("Description")
            meta["user_comment"] = data.get("UserComment")
            meta["width"] = _as_int(data.get("ImageWidth"))
            meta["height"] = _as_int(data.get("ImageHeight"))
            meta["duration_sec"] = _parse_duration(data.get("Duration"))

            lat = dms_to_decimal(str(data.get("GPSLatitude", "")), str(data.get("GPSLatitudeRef", "N")))
            lon = dms_to_decimal(str(data.get("GPSLongitude", "")), str(data.get("GPSLongitudeRef", "E")))
            if lat is not None and lon is not None and (lat or lon):
                meta["latitude"] = lat
                meta["longitude"] = lon

    if meta["year"] is None:
        year_match = re.search(r"/(\d{4})/", str(path))
        if year_match:
            meta["year"] = int(year_match.group(1))

    album = detect_album_from_path(str(path))
    if not album and meta.get("keywords"):
        album = parse_album_from_keywords(meta["keywords"])
    meta["album"] = album
    return meta


def _as_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _parse_duration(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value)
    if text.endswith(" s"):
        try:
            return float(text.replace(" s", ""))
        except ValueError:
            return None
    return None
