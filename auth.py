from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr
import os, time, json, hmac, hashlib, base64
from typing import Optional, Dict, Any

import bcrypt
import db

router = APIRouter(tags=["auth"])

SESSION_COOKIE_NAME = "session"
SESSION_SECRET = os.getenv("SESSION_SECRET", "change-this-in-env")
SESSION_TTL_SECONDS = 60 * 60 * 8  # 8 hours


class LoginIn(BaseModel):
    email: EmailStr
    password: str


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _sign(payload: Dict[str, Any]) -> str:
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    sig = hmac.new(SESSION_SECRET.encode("utf-8"), body, hashlib.sha256).digest()
    return _b64url(body) + "." + _b64url(sig)


def _verify(token: str) -> Optional[Dict[str, Any]]:
    try:
        body_b64, sig_b64 = token.split(".", 1)
        body = _b64url_decode(body_b64)
        sig = _b64url_decode(sig_b64)
        exp_sig = hmac.new(SESSION_SECRET.encode("utf-8"), body, hashlib.sha256).digest()
        if not hmac.compare_digest(sig, exp_sig):
            return None
        payload = json.loads(body.decode("utf-8"))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def _set_session_cookie(resp: Response, user_row) -> None:
    now = int(time.time())
    payload = {
        "sub": int(user_row["id"]),
        "email": user_row["email"],
        "role": user_row["role"],
        "maxCL": user_row["max_clearance_level"],
        "exp": now + SESSION_TTL_SECONDS,
        "iat": now,
    }
    token = _sign(payload)
    # HttpOnly cookie; set secure flag according to environment needs
    resp.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,  # set True when using HTTPS
        max_age=SESSION_TTL_SECONDS,
        path="/",
    )


def _clear_session_cookie(resp: Response) -> None:
    resp.delete_cookie(SESSION_COOKIE_NAME, path="/")


def get_current_user(request: Request) -> Dict[str, Any]:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = _verify(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    # Optionally re-load user to ensure still exists and role not changed to disabled
    rows = db.db_read(
        "SELECT id, email, name, role, max_clearance_level FROM users WHERE id = ?",
        (payload["sub"],),
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    row = rows[0]
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "role": row["role"],
        "max_clearance_level": row["max_clearance_level"],
    }


def require_admin(user=Depends(get_current_user)) -> Dict[str, Any]:
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin required")
    return user


@router.post("/session/login")
def login(payload: LoginIn, response: Response):
    rows = db.db_read(
        "SELECT id, email, name, role, password_hash, max_clearance_level FROM users WHERE email = ?",
        (payload.email.lower(),),
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    row = rows[0]
    pw_ok = False
    try:
        pw_ok = bcrypt.checkpw(payload.password.encode("utf-8"), row["password_hash"].encode("utf-8"))
    except Exception:
        # legacy hashes or corrupted data
        pw_ok = False
    if not pw_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    _set_session_cookie(response, row)
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "role": row["role"],
        "max_clearance_level": row["max_clearance_level"],
    }


@router.post("/session/logout", status_code=204)
def logout(response: Response, _user=Depends(get_current_user)):
    _clear_session_cookie(response)
    return Response(status_code=204)


@router.get("/session/me")
def me(user=Depends(get_current_user)):
    return user
