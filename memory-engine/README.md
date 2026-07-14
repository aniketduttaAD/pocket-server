# Memory Engine (phone-server bundle)

Personal photo intelligence — search, timeline, faces, trips, AI chat.

Bundled inside **phone-server** for Android deployment. The indexed database and
ML models live in `data/` (copied from the Mac; not committed to git).

## On the phone (Termux)

```bash
# 1. Clone phone-server (includes this folder + data/)
git clone <repo> ~/phone-server

# 2. Put photos at ~/storage/dcim  (year folders: 2011/, 2012/, ...)

# 3. One-time setup (proot Ubuntu + Python ML stack)
bash ~/phone-server/scripts/setup-memory-engine.sh

# 4. Start
bash ~/phone-server/scripts/run-memory-engine.sh serve
```

Open http://127.0.0.1:8765 — or https://memory.yourdomain.com via Cloudflare tunnel.

## CLI (via run-memory-engine.sh)

```bash
bash ~/phone-server/scripts/run-memory-engine.sh status
bash ~/phone-server/scripts/run-memory-engine.sh ingest
bash ~/phone-server/scripts/run-memory-engine.sh search "Maa 2023"
```

## Layout

```
memory-engine/
├── memory_engine/   Python package
├── web/             React UI (dist/ pre-built)
├── data/            DB + FAISS + models (local only)
├── scripts/         relocate_paths.py, run.sh
├── config.phone.yaml
└── requirements.txt
```
