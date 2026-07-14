from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]


@dataclass
class EngineConfig:
    photos_root: Path
    data_dir: Path
    host: str = "127.0.0.1"
    port: int = 8765
    face_model: str = "buffalo_l"
    vision_model: str = "ViT-B-32"
    vision_pretrained: str = "laion2b_s34b_b79k"
    whisper_model: str = "small"
    image_workers: int = 8
    video_workers: int = 2
    geo_eps_km: float = 0.5
    trip_min_photos: int = 4
    trip_max_days: int = 14
    home_radius_km: float = 2.0
    local_llm_enabled: bool = True
    local_llm_file: str = "qwen2.5-1.5b-instruct-q4_k_m.gguf"
    local_llm_url: str = (
        "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/"
        "resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"
    )
    local_llm_n_ctx: int = 2048
    local_llm_max_tokens: int = 400
    local_llm_threads: int = 0
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_text_model: str = "llama3.2"
    ollama_vision_model: str = "llava"
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "memory.db"

    @property
    def faiss_path(self) -> Path:
        return self.data_dir / "vectors.faiss"

    @property
    def models_dir(self) -> Path:
        return self.data_dir / "models"

    @property
    def transcripts_dir(self) -> Path:
        return self.data_dir / "transcripts"

    @property
    def geocode_cache_dir(self) -> Path:
        return self.data_dir / "geocode_cache"

    def ensure_dirs(self) -> None:
        for d in (
            self.data_dir,
            self.models_dir,
            self.transcripts_dir,
            self.geocode_cache_dir,
        ):
            d.mkdir(parents=True, exist_ok=True)


def load_config(path: Path | None = None) -> EngineConfig:
    cfg_path = path or (WORKSPACE_ROOT / "config.yaml")
    raw: dict[str, Any] = {}
    if cfg_path.exists():
        with cfg_path.open(encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}

    photos = WORKSPACE_ROOT / raw.get("photos_root", "photos")
    data = WORKSPACE_ROOT / raw.get("data_dir", "data")
    models = raw.get("models", {})
    pipeline = raw.get("pipeline", {})
    ollama = raw.get("ollama", {})
    local_llm = raw.get("local_llm", {})

    return EngineConfig(
        photos_root=photos.resolve(),
        data_dir=data.resolve(),
        host=raw.get("host", "127.0.0.1"),
        port=int(raw.get("port", 8765)),
        face_model=models.get("face", "buffalo_l"),
        vision_model=models.get("vision", "ViT-B-32"),
        vision_pretrained=models.get("vision_pretrained", "laion2b_s34b_b79k"),
        whisper_model=models.get("whisper", "small"),
        image_workers=int(pipeline.get("image_workers", 8)),
        video_workers=int(pipeline.get("video_workers", 2)),
        geo_eps_km=float(pipeline.get("geo_eps_km", 0.5)),
        trip_min_photos=int(pipeline.get("trip_min_photos", 4)),
        trip_max_days=int(pipeline.get("trip_max_days", 14)),
        home_radius_km=float(pipeline.get("home_radius_km", 2.0)),
        local_llm_enabled=bool(local_llm.get("enabled", True)),
        local_llm_file=local_llm.get("model_file", "qwen2.5-1.5b-instruct-q4_k_m.gguf"),
        local_llm_url=local_llm.get(
            "model_url",
            "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/"
            "resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
        ),
        local_llm_n_ctx=int(local_llm.get("n_ctx", 2048)),
        local_llm_max_tokens=int(local_llm.get("max_tokens", 400)),
        local_llm_threads=int(local_llm.get("n_threads", 0)),
        ollama_base_url=ollama.get("base_url", "http://127.0.0.1:11434"),
        ollama_text_model=ollama.get("text_model", "llama3.2"),
        ollama_vision_model=ollama.get("vision_model", "llava"),
        extra=raw,
    )
