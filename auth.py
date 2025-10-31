from contextlib import closing
import hmac, hashlib, base64, json, time, bcrypt
from fastapi import APIRouter, Request, Response
from fastapi import HTTPException, status, Body, Depends
from typing import Optional
import db
from pydantic import BaseModel, EmailStr
import sqlite3


router = APIRouter()

SESSION_COOKIE_NAME = "fms_session"
SESSION_SECRET = b"super-secret-change-me"  # TODO env
SESSION_TTL_SECONDS = 4 * 60 * 60  # 4 hours

def _sign_data(raw: bytes) -> str:
    sig = hmac.new(SESSION_SECRET, raw, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(sig).decode("utf-8")

def _encode_session(payload: dict) -> str:
    body_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    body_b64   = base64.urlsafe_b64encode(body_bytes).decode("utf-8")
    sig_b64    = _sign_data(body_bytes)
    return f"{body_b64}.{sig_b64}"

def _decode_session(token: str) -> Optional[dict]:
    try:
        body_b64, sig_b64 = token.split(".", 1)
    except ValueError:
        return None

    try:
        body_bytes = base64.urlsafe_b64decode(body_b64.encode("utf-8"))
    except Exception:
        return None

    expected_sig = _sign_data(body_bytes)
    if not hmac.compare_digest(sig_b64, expected_sig):
        return None

    try:
        payload = json.loads(body_bytes.decode("utf-8"))
    except Exception:
        return None

    exp = payload.get("exp")
    if not isinstance(exp, (int, float)):
        return None
    if int(time.time()) > exp:
        return None

    return payload

def _set_session_cookie(response: Response, email: str, role: str):
    now_ts = int(time.time())
    payload = {
        "email": email,
        "role": role,
        "exp": now_ts + SESSION_TTL_SECONDS,
    }
    token = _encode_session(payload)

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=False,      # True if HTTPS only
        samesite="lax",
        max_age=SESSION_TTL_SECONDS,
        path="/",
    )

def _clear_session_cookie(response: Response):
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/"
    )

def get_current_user(request: Request) -> Optional[dict]:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None

    data = _decode_session(token)
    if not data:
        return None

    # { "email": ..., "role": ... }
    return {"email": data.get("email"), "role": data.get("role")}

def require_operator(user: Optional[dict]):
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated."
        )
    if user.get("role") != "operator":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operator role required."
        )



@router.post("/api/session/login")
def login(
    response: Response,
    email: str = Body(...),
    password: str = Body(...),
):
    rows = db.db_read(
        """
        SELECT id, email, role, password_hash, active
        FROM users
        WHERE email = ?
        LIMIT 1
        """,
        (email.strip().lower(),)
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")

    u = dict(rows[0])

    if u["active"] != 1:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled.")

    # bcrypt verify
    if not bcrypt.checkpw(password.encode("utf-8"), u["password_hash"].encode("utf-8")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")

    # issue cookie
    _set_session_cookie(
        response,
        email=u["email"],  
        role=u["role"],
    )

    return {"email": u["email"], "role": u["role"]}

@router.get("/api/session/me")
def session_me(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated."
        )
    return user

@router.post("/api/session/logout")
def logout(response: Response):
    _clear_session_cookie(response)
    return {"status": "logged_out"}

class NewUser(BaseModel):
    email: EmailStr
    password: str
    role: str 
    
@router.get("/users")
def list_users(user=Depends(require_operator)):
    from db import get_conn
    with closing(get_conn()) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT email, role, created_at FROM users ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]

@router.post("/users", status_code=201)
def create_user(payload: NewUser, user=Depends(require_operator)):
    role = payload.role.lower().strip()
    if role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="role must be 'admin' or 'user'")

    pw = payload.password.strip()
    if len(pw) < 8:
        raise HTTPException(status_code=400, detail="password too short (min 8 chars)")

    pw_hash = bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    from db import get_conn
    try:
        with closing(get_conn()) as conn, conn:
            conn.execute("""
                INSERT INTO users (email, password_hash, role)
                VALUES (?, ?, ?)
            """, (payload.email.lower(), pw_hash, role))
        return {"ok": True}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="email already exists")
    
    
    router = APIRouter(prefix="/api", tags=["auth"])