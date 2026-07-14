# Memory Engine (bundled in pocket-server / phone-server)

Personal photo intelligence — search, timeline, faces, trips, AI chat.

## On the phone (Termux)

Repo may be named `pocket-server` or `phone-server` — scripts auto-detect.

```bash
# 1. Photos at ~/storage/dcim with year folders (2011/, 2012/, ...)
termux-setup-storage

# 2. Make sure data/ is present (indexed DB + models from Mac)
ls ~/pocket-server/memory-engine/data/memory.db

# 3. One-time install (proot Ubuntu + Python ML stack)
bash ~/pocket-server/scripts/setup-memory-engine.sh

# 4. Register with PM2 (same as dash / media)
bash ~/pocket-server/scripts/pm2-memory-engine.sh
```

Then:

```bash
pm2 list              # expect: memory (online)
pm2 logs memory
pm2 restart memory
```

Open http://127.0.0.1:8765 — or https://memory.yourdomain.com via Cloudflare.

## If memory.db is missing

`data/` is large (~2.5 GB) and usually not in git. Copy from Mac:

```bash
# on Mac
rsync -avz --progress \
  "./phone-server/memory-engine/data/" \
  phone:~/pocket-server/memory-engine/data/
```

## Layout

```
memory-engine/
├── memory_engine/   Python package
├── web/             React UI (dist/ pre-built)
├── data/            DB + FAISS + models (required)
├── scripts/
├── config.phone.yaml
└── requirements.txt
```
