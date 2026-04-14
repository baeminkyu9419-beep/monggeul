"""WORKROOT 설정 관리 — API 키, 환경변수, Supabase 연동"""

import json
import os
from pathlib import Path
from config.logger import get_logger

_log = get_logger("settings")

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"

SECRET_ENV_MAP = {
    "openai_api_key": "OPENAI_API_KEY",
    "anthropic_api_key": "ANTHROPIC_API_KEY",
    "gemini_api_key": "GEMINI_API_KEY",
    "supabase_url": "SUPABASE_URL",
    "supabase_anon_key": "SUPABASE_ANON_KEY",
    "supabase_service_role_key": "SUPABASE_SERVICE_ROLE_KEY",
    "qdrant_url": "QDRANT_URL",
    "qdrant_api_key": "QDRANT_API_KEY",
    "elevenlabs_api_key": "ELEVENLABS_API_KEY",
}

DEFAULTS = {
    "openai_api_key": "",
    "anthropic_api_key": "",
    "gemini_api_key": "",
    "model": "gpt-4.1",
    "embedding_model": "text-embedding-3-large",
    "supabase_url": "",
    "supabase_anon_key": "",
    "supabase_service_role_key": "",
    "qdrant_url": "",
    "qdrant_api_key": "",
    "qdrant_collection": "workroot_memory",
}


def _parse_env(path) -> dict:
    env = {}
    try:
        p = Path(path)
        if not p.exists():
            return env
        for raw in p.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip("\"'")
    except Exception:
        pass
    return env


MOTHER_ENV = Path("C:/JARVIS_NEW/.env.shared")


def load_env_file(path=ENV_PATH) -> dict:
    # 마더 공통 키 먼저 → 프로젝트 전용 키로 override
    env = _parse_env(MOTHER_ENV)
    env.update(_parse_env(path))
    return env


def env_value(name: str, dotenv: dict | None = None) -> str:
    value = os.environ.get(name)
    if value:
        return value
    if dotenv and dotenv.get(name):
        return dotenv.get(name, "")
    return ""


def load_config() -> dict:
    data = DEFAULTS.copy()
    dotenv = load_env_file()
    for config_key, env_name in SECRET_ENV_MAP.items():
        value = env_value(env_name, dotenv)
        if value:
            data[config_key] = value
    return data


def get_api_key(name: str) -> str:
    dotenv = load_env_file()
    return env_value(name, dotenv)


def get_supabase_config() -> dict:
    cfg = load_config()
    return {
        "url": cfg.get("supabase_url", ""),
        "anon_key": cfg.get("supabase_anon_key", ""),
        "service_role_key": cfg.get("supabase_service_role_key", ""),
    }


def get_qdrant_config() -> dict:
    cfg = load_config()
    return {
        "url": cfg.get("qdrant_url", ""),
        "api_key": cfg.get("qdrant_api_key", ""),
        "collection": cfg.get("qdrant_collection", "workroot_memory"),
    }
