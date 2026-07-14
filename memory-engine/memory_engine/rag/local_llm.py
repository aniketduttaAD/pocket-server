"""Built-in local text LLM via llama-cpp-python (no Ollama required)."""
from __future__ import annotations

import logging
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any

from memory_engine.core.config import EngineConfig

logger = logging.getLogger(__name__)

_LLM_INSTANCE: Any = None
_LLM_LOAD_FAILED = False

DEFAULT_MODEL_FILE = "qwen2.5-1.5b-instruct-q4_k_m.gguf"
DEFAULT_MODEL_URL = (
    "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/"
    "resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"
)


def llm_model_path(config: EngineConfig) -> Path:
    return config.models_dir / "llm" / config.local_llm_file


def download_model(config: EngineConfig, force: bool = False) -> Path:
    """Download the GGUF model to data/models/llm/ if missing."""
    dest = llm_model_path(config)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not force:
        return dest

    url = config.local_llm_url
    logger.info("Downloading local LLM (~1 GB): %s", url)
    tmp = dest.with_suffix(".gguf.part")

    def _progress(block_num: int, block_size: int, total_size: int) -> None:
        if total_size > 0 and block_num % 200 == 0:
            pct = min(100, block_num * block_size * 100 // total_size)
            logger.info("Download progress: %s%%", pct)

    urllib.request.urlretrieve(url, tmp, reporthook=_progress)
    tmp.rename(dest)
    logger.info("Local LLM saved to %s", dest)
    return dest


def llm_status(config: EngineConfig) -> dict[str, Any]:
    path = llm_model_path(config)
    return {
        "enabled": config.local_llm_enabled,
        "model_file": config.local_llm_file,
        "model_path": str(path),
        "downloaded": path.exists(),
        "loaded": _LLM_INSTANCE is not None,
        "size_mb": round(path.stat().st_size / (1024 * 1024), 1) if path.exists() else 0,
    }


def _load_llm(config: EngineConfig) -> Any:
    global _LLM_INSTANCE, _LLM_LOAD_FAILED
    if _LLM_LOAD_FAILED:
        return None
    if _LLM_INSTANCE is not None:
        return _LLM_INSTANCE
    if not config.local_llm_enabled:
        return None

    try:
        from llama_cpp import Llama
    except ImportError:
        logger.warning("llama-cpp-python not installed; pip install llama-cpp-python")
        _LLM_LOAD_FAILED = True
        return None

    path = download_model(config)
    n_threads = config.local_llm_threads or max(1, (os.cpu_count() or 4) - 1)
    logger.info("Loading local LLM from %s (threads=%s)", path, n_threads)

    kwargs: dict[str, Any] = {
        "model_path": str(path),
        "n_ctx": config.local_llm_n_ctx,
        "n_threads": n_threads,
        "verbose": False,
    }
    # Apple Silicon: use Metal GPU — faster and uses less RAM pressure on CPU.
    if sys.platform == "darwin":
        kwargs["n_gpu_layers"] = -1

    try:
        _LLM_INSTANCE = Llama(**kwargs)
    except ValueError:
        logger.warning("Retrying local LLM with smaller context window")
        kwargs["n_ctx"] = 2048
        kwargs.pop("n_gpu_layers", None)
        try:
            _LLM_INSTANCE = Llama(**kwargs)
        except Exception as exc:
            logger.warning("Local LLM load failed: %s", exc)
            _LLM_LOAD_FAILED = True
            return None
    return _LLM_INSTANCE


def generate(config: EngineConfig, prompt: str, max_tokens: int | None = None) -> str | None:
    """Generate text with the built-in local model. Returns None if unavailable."""
    llm = _load_llm(config)
    if llm is None:
        return None

    max_tokens = max_tokens or config.local_llm_max_tokens
    try:
        out = llm.create_chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a private local photo memory assistant. "
                        "The user question has already been answered by retrieving matching photos — "
                        "those photos ARE the answer. Never say you could not find photos when memories "
                        "are listed below. Describe what you found: dates, people, places, and scene tags. "
                        "If the user asks for 'smiling' photos and results are tagged as selfies, "
                        "describe them as likely smiling selfies. Be warm, concise, and factual."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=max_tokens,
            temperature=0.3,
        )
        text = out["choices"][0]["message"]["content"].strip()
        return text or None
    except Exception as exc:
        logger.warning("Local LLM generation failed: %s", exc)
        return None
