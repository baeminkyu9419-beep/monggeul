"""Supabase JWT 인증 의존성"""
import os
from fastapi import Depends, HTTPException, Request
from config.settings import get_supabase_config
import jwt as pyjwt

_supabase_jwt_secret = None


def _get_jwt_secret():
    """JWT 서명 검증용 시크릿. SUPABASE_JWT_SECRET 우선, 없으면 anon_key fallback."""
    global _supabase_jwt_secret
    if _supabase_jwt_secret:
        return _supabase_jwt_secret
    # 전용 JWT secret 환경변수 우선
    secret = os.environ.get("SUPABASE_JWT_SECRET", "")
    if not secret:
        cfg = get_supabase_config()
        secret = cfg.get("jwt_secret", "") or cfg.get("anon_key", "")
    _supabase_jwt_secret = secret
    return _supabase_jwt_secret


def _is_production() -> bool:
    return bool(
        os.environ.get("RAILWAY_ENVIRONMENT")
        or os.environ.get("NODE_ENV") == "production"
    )


async def get_current_user(request: Request) -> dict:
    """Authorization 헤더에서 JWT를 검증하고 사용자 정보 반환.
    - secret 설정됨: HS256 서명 검증 (프로덕션 안전)
    - secret 없음 + dev: 서명 미검증 (개발 편의)
    - secret 없음 + prod: 401 거부
    """
    auth = request.headers.get("authorization", "")
    is_prod = _is_production()

    if auth.startswith("Bearer "):
        token = auth[7:]
        try:
            secret = _get_jwt_secret()
            if secret:
                # 서명 검증 활성화
                payload = pyjwt.decode(
                    token, secret, algorithms=["HS256"],
                    options={"verify_aud": False}
                )
            else:
                # Gen113 iter#9.5 VULN_AUDIT Phase B-3-3 패치 [role-guard-bypass]
                # dev 폴백은 DEV_MODE_JWT_BYPASS=1 명시 시에만 허용
                if is_prod:
                    raise HTTPException(status_code=401, detail="JWT secret not configured")
                if os.environ.get("DEV_MODE_JWT_BYPASS", "") != "1":
                    raise HTTPException(status_code=401, detail="JWT secret not configured (set DEV_MODE_JWT_BYPASS=1 for dev)")
                payload = pyjwt.decode(token, options={"verify_signature": False})

            user_id = payload.get("sub", "")
            email = payload.get("email", "")
            role = payload.get("role", "anon")
            return {"user_id": user_id, "email": email, "role": role, "authenticated": True}
        except HTTPException:
            raise
        except Exception as e:
            from config.logger import get_logger
            get_logger("auth").warning("JWT 디코드 실패 — %s", type(e).__name__)
            if is_prod:
                raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다")

    # JWT 없거나 디코드 실패
    if is_prod:
        raise HTTPException(status_code=401, detail="인증이 필요합니다")

    from config.logger import get_logger
    get_logger("auth").warning("JWT 없음 — 개발 모드 폴백")
    return {"user_id": "", "email": "", "role": "anon", "authenticated": False}


def require_plan(min_plan: str = "free"):
    """특정 플랜 이상이어야 접근 가능한 의존성"""
    plan_order = {"free": 0, "starter": 1, "pro": 2, "enterprise": 3}

    async def check_plan(user: dict = Depends(get_current_user)):
        if not user.get("authenticated"):
            return user  # 개발 모드에서는 통과
        # TODO: Supabase에서 사용자 플랜 조회
        user["plan"] = "free"  # 기본값
        min_level = plan_order.get(min_plan, 0)
        user_level = plan_order.get(user.get("plan", "free"), 0)
        if user_level < min_level:
            raise HTTPException(
                403, f"이 기능은 {min_plan} 플랜 이상에서 사용 가능합니다."
            )
        return user

    return check_plan
