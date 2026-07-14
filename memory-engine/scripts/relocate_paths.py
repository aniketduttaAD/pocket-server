#!/usr/bin/env python3
"""Relocate stored media paths after moving the library to a new machine/folder.

The database stores an absolute ``abs_path`` for every media file. When the
photo library is moved (e.g. Mac -> Android phone) those absolute paths break.
This rebuilds ``abs_path`` from the current ``photos_root`` + the stable
``rel_path`` (e.g. ``2023/IMG_0001.jpg``), so the engine works in the new
location without re-indexing.

Usage:
    python scripts/relocate_paths.py                 # use photos_root from config.yaml
    python scripts/relocate_paths.py --photos-root /root/photos
    python scripts/relocate_paths.py --dry-run
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from memory_engine.core.config import load_config
from memory_engine.core.db import Database


def relocate(photos_root: Path, dry_run: bool = False) -> dict[str, int]:
    config = load_config()
    db = Database(config.db_path)

    updated = 0
    missing = 0
    total = 0
    samples_missing: list[str] = []

    with db.connect() as conn:
        rows = conn.execute("SELECT id, rel_path FROM media").fetchall()
        total = len(rows)
        for row in rows:
            rel_path = row["rel_path"]
            if not rel_path:
                continue
            new_abs = str((photos_root / rel_path).resolve())
            if not Path(new_abs).exists():
                missing += 1
                if len(samples_missing) < 5:
                    samples_missing.append(rel_path)
            if not dry_run:
                conn.execute(
                    "UPDATE media SET abs_path = ? WHERE id = ?",
                    (new_abs, row["id"]),
                )
            updated += 1
        if not dry_run:
            conn.commit()

    print(f"photos_root : {photos_root}")
    print(f"total media : {total}")
    print(f"{'would update' if dry_run else 'updated'}    : {updated}")
    print(f"missing file: {missing}")
    if samples_missing:
        print("missing samples (first 5):")
        for s in samples_missing:
            print(f"  - {s}")
    if missing and missing == total:
        print(
            "\nWARNING: every file is missing at the new root. "
            "Check that --photos-root points at the folder that directly "
            "contains the year subfolders (2011/, 2012/, ...)."
        )
    return {"total": total, "updated": updated, "missing": missing}


def main() -> int:
    parser = argparse.ArgumentParser(description="Relocate media paths to a new photo root")
    parser.add_argument(
        "--photos-root",
        type=Path,
        default=None,
        help="New absolute photos root. Defaults to photos_root from config.yaml.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would change without writing to the database.",
    )
    args = parser.parse_args()

    photos_root = args.photos_root
    if photos_root is None:
        photos_root = load_config().photos_root
    photos_root = photos_root.expanduser().resolve()

    relocate(photos_root, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
