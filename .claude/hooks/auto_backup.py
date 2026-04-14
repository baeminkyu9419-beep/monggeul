#!/usr/bin/env python3
"""
Mother 공용 자동 백업 — Stop 훅에서 호출

프로젝트에 무관하게 동작:
1. git diff로 변경 감지 → 변경 없으면 스킵
2. 변경 파일 + 핵심 패턴 파일 자동 탐지 → ZIP 백업
3. 백업 이력을 data/backup_log.json에 기록
4. 오래된 백업 자동 정리 (MAX_BACKUPS 초과 시)
"""

import json
import os
import sys
import io
import subprocess
import zipfile
from datetime import datetime
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

# 환경변수 BACKUP_PROJECT_DIR 우선, 없으면 파일 위치 기반 추론
_env_dir = os.environ.get("BACKUP_PROJECT_DIR", "")
PROJECT = Path(_env_dir) if _env_dir else Path(__file__).resolve().parent.parent.parent
PROJECT_NAME = PROJECT.name.lower()
BACKUP_DIR = PROJECT / "data" / "backups"
BACKUP_LOG = PROJECT / "data" / "backup_log.json"
MAX_BACKUPS = 50
MIN_KEEP = 5

# 공통 핵심 파일 패턴 — 존재하는 것만 백업
COMMON_PATTERNS = [
    ".env",
    ".claude/settings.local.json",
    ".claude/hooks/*.py",
    ".claude/hooks/*.sh",
    "CLAUDE.md",
    "EVOLUTION.md",
]

# 확장자별 핵심 파일 자동 탐지 패턴
CRITICAL_EXTENSIONS = {".db", ".sqlite", ".sqlite3"}
CRITICAL_NAMES = {
    "config.json", "settings.json", "personas.json", "accounts.json",
    "schedule.json", "package.json", "requirements.txt",
    "landing.html", "dashboard.html", "release_notes.html",
}


def _run_git(*args):
    try:
        r = subprocess.run(
            ["git"] + list(args),
            cwd=str(PROJECT),
            capture_output=True, text=True, encoding="utf-8",
            timeout=10
        )
        return r.returncode == 0, r.stdout.strip()
    except Exception:
        return False, ""


def _load_log():
    try:
        return json.loads(BACKUP_LOG.read_text(encoding="utf-8"))
    except Exception:
        return {"backups": []}


def _save_log(log):
    BACKUP_LOG.parent.mkdir(parents=True, exist_ok=True)
    BACKUP_LOG.write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")


def _collect_targets() -> list:
    """백업 대상 자동 수집: 변경 파일 + 핵심 패턴"""
    targets = set()

    # 1. git 변경 파일 (diff + staged + untracked)
    for cmd in [
        ("diff", "--name-only"),
        ("diff", "--cached", "--name-only"),
        ("ls-files", "--others", "--exclude-standard"),
    ]:
        ok, out = _run_git(*cmd)
        if ok:
            for f in out.split("\n"):
                f = f.strip()
                if f:
                    targets.add(f)

    # 2. 공통 패턴 (glob 확장)
    for pattern in COMMON_PATTERNS:
        if "*" in pattern:
            for p in PROJECT.glob(pattern):
                if p.is_file():
                    targets.add(str(p.relative_to(PROJECT)))
        else:
            if (PROJECT / pattern).exists():
                targets.add(pattern)

    # 3. DB 파일 자동 탐지 (프로젝트 루트 + 1단계 서브디렉토리)
    for search_dir in [PROJECT] + [d for d in PROJECT.iterdir() if d.is_dir() and not d.name.startswith(".")]:
        try:
            for f in search_dir.iterdir():
                if f.is_file():
                    if f.suffix in CRITICAL_EXTENSIONS:
                        targets.add(str(f.relative_to(PROJECT)))
                    if f.name in CRITICAL_NAMES:
                        targets.add(str(f.relative_to(PROJECT)))
        except PermissionError:
            continue

    return sorted(targets)


def has_changes() -> bool:
    """git diff로 변동사항 감지"""
    ok, diff = _run_git("diff", "--name-only")
    ok2, staged = _run_git("diff", "--cached", "--name-only")
    ok3, untracked = _run_git("ls-files", "--others", "--exclude-standard")

    all_changes = [f for f in (diff + "\n" + staged + "\n" + untracked).split("\n") if f.strip()]
    return len(all_changes) > 0


def create_backup(reason: str = "auto") -> dict:
    """핵심 파일 ZIP 백업 생성"""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"{PROJECT_NAME}_backup_{timestamp}.zip"
    zip_path = BACKUP_DIR / zip_name

    targets = _collect_targets()

    backed_up = []
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for target in targets:
            full_path = PROJECT / target
            if full_path.exists() and full_path.is_file():
                try:
                    # 너무 큰 파일 스킵 (50MB+)
                    if full_path.stat().st_size > 50 * 1024 * 1024:
                        continue
                    zf.write(full_path, target)
                    backed_up.append(target)
                except (PermissionError, OSError):
                    continue

    if not backed_up:
        # 빈 백업 삭제
        zip_path.unlink(missing_ok=True)
        return {"status": "skip", "reason": "no files to backup"}

    size_kb = zip_path.stat().st_size // 1024

    log = _load_log()
    entry = {
        "timestamp": datetime.now().isoformat(),
        "file": zip_name,
        "size_kb": size_kb,
        "files_count": len(backed_up),
        "reason": reason,
    }
    log["backups"].append(entry)

    # 오래된 백업 정리
    keep = list(log["backups"])
    if len(keep) > MAX_BACKUPS:
        to_remove = keep[:-MAX_BACKUPS]
        remaining = keep[len(to_remove):]
        if len(remaining) < MIN_KEEP:
            to_remove = keep[:len(keep) - MIN_KEEP]
            remaining = keep[len(to_remove):]
        for old in to_remove:
            old_path = BACKUP_DIR / old["file"]
            if old_path.exists():
                old_path.unlink()
        keep = remaining

    log["backups"] = keep
    _save_log(log)

    return {
        "status": "backed_up",
        "file": zip_name,
        "size_kb": size_kb,
        "files": len(backed_up),
        "total_backups": len(keep),
    }


def run_backup_if_needed() -> dict:
    """변동사항 있을 때만 백업 실행"""
    if not has_changes():
        return {"status": "skip", "reason": "no changes"}

    return create_backup("session_end")


def list_backups() -> list:
    """백업 목록 조회"""
    log = _load_log()
    return log.get("backups", [])


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--force":
        result = create_backup("manual")
    else:
        result = run_backup_if_needed()

    print(json.dumps(result, ensure_ascii=False))
