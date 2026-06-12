# ── Windows 콘솔창 차단 가드 (2026-06-12 박제: cmd 폭주 구조 차단, 원칙4) ──
# 테스트와 그 자식 트리가 무엇을 스폰하든 새 콘솔창 0 — CREATE_NO_WINDOW 강제 주입.
# (창 없는 콘솔은 손자 프로세스에도 상속됨. 명시적 NEW_CONSOLE/DETACHED 요청만 예외)
import subprocess as _sp
import sys as _sys
if _sys.platform == "win32" and not getattr(_sp.Popen, "_jarvis_no_window", False):
    _orig_popen_init = _sp.Popen.__init__
    _CONSOLE_FLAGS = _sp.CREATE_NEW_CONSOLE | 0x00000008  # DETACHED_PROCESS
    def _quiet_popen_init(self, *a, **k):
        cf = k.get("creationflags", 0)
        if not (cf & _CONSOLE_FLAGS):
            k["creationflags"] = cf | _sp.CREATE_NO_WINDOW
        return _orig_popen_init(self, *a, **k)
    _sp.Popen.__init__ = _quiet_popen_init
    _sp.Popen._jarvis_no_window = True

