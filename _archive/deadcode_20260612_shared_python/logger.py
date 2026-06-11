"""ONGLE 중앙 로깅 — 콘솔 + 파일 동시 출력, 모듈별 로거 생성"""

import logging
import sys
from pathlib import Path
from datetime import datetime

_LOG_DIR = Path(__file__).resolve().parent.parent / "runtime_logs"
_initialized = False


def _ensure_dir():
    _LOG_DIR.mkdir(parents=True, exist_ok=True)


def setup_logging(level: int = logging.INFO):
    """루트 로거 초기화 — 앱 시작 시 1회 호출"""
    global _initialized
    if _initialized:
        return
    _initialized = True
    _ensure_dir()

    root = logging.getLogger("ongle")
    root.setLevel(level)

    # 콘솔 핸들러 (INFO 이상)
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(logging.INFO)
    console.setFormatter(logging.Formatter(
        "[%(levelname)s] %(message)s"
    ))

    # 파일 핸들러 (DEBUG 이상, 일자별)
    today = datetime.now().strftime("%Y-%m-%d")
    fh = logging.FileHandler(
        _LOG_DIR / f"ongle_{today}.log", encoding="utf-8"
    )
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(
        "%(asctime)s [%(name)s] %(levelname)s — %(message)s",
        datefmt="%H:%M:%S",
    ))

    root.addHandler(console)
    root.addHandler(fh)


def get_logger(name: str) -> logging.Logger:
    """모듈별 로거 반환 — ongle.{name} 네임스페이스"""
    setup_logging()
    return logging.getLogger(f"ongle.{name}")
