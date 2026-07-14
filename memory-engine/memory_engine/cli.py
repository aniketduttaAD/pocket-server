from __future__ import annotations

import os

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import argparse
import logging
import sys

import uvicorn

from memory_engine.core.config import load_config
from memory_engine.core.db import Database
from memory_engine.core.pipeline import PipelineRunner, STAGES
from memory_engine.core.watcher import IncrementalWatcher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)


def cmd_ingest(args: argparse.Namespace) -> int:
    config = load_config()
    config.ensure_dirs()
    db = Database(config.db_path)
    db.init_schema()
    runner = PipelineRunner(config, db)
    stages = args.stages or STAGES
    results = runner.run_all(full=args.full, stages=stages)
    print("Ingest complete:")
    for stage, result in results.items():
        print(f"  {stage}: {result}")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    config = load_config()
    db = Database(config.db_path)
    if not config.db_path.exists():
        print("Database not initialized. Run: python -m memory_engine ingest")
        return 1
    stats = db.stats()
    print("Memory Engine status")
    print(f"  Photos root: {config.photos_root}")
    print(f"  Data dir:    {config.data_dir}")
    for key, value in stats.items():
        print(f"  {key}: {value}")
    from memory_engine.rag.local_llm import llm_status

    llm = llm_status(config)
    print("Local LLM:")
    print(f"  enabled:    {llm['enabled']}")
    print(f"  downloaded: {llm['downloaded']}")
    if llm["downloaded"]:
        print(f"  size_mb:    {llm['size_mb']}")
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    from memory_engine.search.hybrid import HybridSearch

    config = load_config()
    db = Database(config.db_path)
    results = HybridSearch(config, db).search(args.query, limit=args.limit)
    for item in results:
        print(f"{item['id']}\t{item.get('taken_at')}\t{item['rel_path']}")
    print(f"\n{len(results)} results")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    config = load_config()
    uvicorn.run(
        "memory_engine.api.main:app",
        host=config.host,
        port=config.port,
        reload=args.reload,
    )
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    config = load_config()
    config.ensure_dirs()
    db = Database(config.db_path)
    db.init_schema()
    watcher = IncrementalWatcher(config, db)
    watcher.start()
    print(f"Watching {config.photos_root}. Press Ctrl+C to stop.")
    try:
        import time

        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        watcher.stop()
    return 0


def cmd_download_llm(args: argparse.Namespace) -> int:
    from memory_engine.rag.local_llm import download_model, llm_status

    config = load_config()
    config.ensure_dirs()
    path = download_model(config, force=args.force)
    status = llm_status(config)
    print(f"Local LLM ready: {path}")
    print(f"Size: {status['size_mb']} MB")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Local Photo Memory Engine")
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest", help="Run indexing pipeline")
    ingest.add_argument("--full", action="store_true", help="Re-index all files")
    ingest.add_argument(
        "--stages",
        nargs="+",
        choices=STAGES,
        help="Run specific stages only",
    )
    ingest.set_defaults(func=cmd_ingest)

    status = sub.add_parser("status", help="Show engine statistics")
    status.set_defaults(func=cmd_status)

    search = sub.add_parser("search", help="Hybrid search")
    search.add_argument("query", help="Search query")
    search.add_argument("--limit", type=int, default=20)
    search.set_defaults(func=cmd_search)

    serve = sub.add_parser("serve", help="Start API and web UI")
    serve.add_argument("--reload", action="store_true")
    serve.set_defaults(func=cmd_serve)

    watch = sub.add_parser("watch", help="Watch for new photos and index incrementally")
    watch.set_defaults(func=cmd_watch)

    dl = sub.add_parser("download-llm", help="Download built-in local chat model (~1 GB)")
    dl.add_argument("--force", action="store_true", help="Re-download even if present")
    dl.set_defaults(func=cmd_download_llm)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
