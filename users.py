from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, List, Literal

import bcrypt
import db
from auth import get_current_user, require_admin

router = APIRouter(tags=["users"])


class UserCreate(BaseModel):
    email: EmailStr
    name: str
    role: Literal["admin", "user"]
    password: str
    max_clearance_level: Optional[int] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name required")
        return v.strip()


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Literal["admin", "user"]] = None
    password: Optional[str] = None
    max_clearance_level: Optional[Optional[int]] = None  # allow nulling to unlimited


class UserPublic(BaseModel):
    email: EmailStr
    role: Literal["admin", "user"]


class UserAdminView(UserPublic):
    id: int
    name: str
    max_clearance_level: Optional[int]
    created_at: str


@router.get("/users", response_model=List[UserPublic])
def list_users(current=Depends(get_current_user)):
    rows = db.db_read("SELECT id, email, name, role, max_clearance_level, created_at FROM users ORDER BY created_at DESC")
    if current["role"] == "admin":
        # Return richer data to admins
        return [
            {
                "email": r["email"],
                "role": r["role"],
                # Pydantic response_model enforces shape; admins can use /users/admin for full detail if needed
            }
            for r in rows
        ]
    else:
        return [{"email": r["email"], "role": r["role"]} for r in rows]


@router.get("/users/admin", response_model=List[UserAdminView], dependencies=[Depends(require_admin)])
def list_users_admin():
    rows = db.db_read("SELECT id, email, name, role, max_clearance_level, created_at FROM users ORDER BY created_at DESC")
    return [
        {
            "id": r["id"],
            "email": r["email"],
            "name": r["name"],
            "role": r["role"],
            "max_clearance_level": r["max_clearance_level"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.post("/users", status_code=201, dependencies=[Depends(require_admin)])
def create_user(payload: UserCreate):
    email = payload.email.lower()
    exists = db.db_read("SELECT 1 FROM users WHERE email = ?", (email,))
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
    pw_hash = bcrypt.hashpw(payload.password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    uid = db.db_write(
        """
        INSERT INTO users(email, name, role, password_hash, max_clearance_level)
        VALUES (?, ?, ?, ?, ?)
        """,
        (email, payload.name.strip(), payload.role, pw_hash, payload.max_clearance_level),
    )
    row = db.db_read("SELECT id, email, name, role, max_clearance_level, created_at FROM users WHERE id = ?", (uid,))[0]
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "role": row["role"],
        "max_clearance_level": row["max_clearance_level"],
        "created_at": row["created_at"],
    }


@router.put("/users/{user_id}", dependencies=[Depends(require_admin)])
def update_user(user_id: int, payload: UserUpdate):
    rows = db.db_read("SELECT id FROM users WHERE id = ?", (user_id,))
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    fields = []
    params = []

    if payload.name is not None:
        fields.append("name = ?")
        params.append(payload.name.strip())

    if payload.role is not None:
        fields.append("role = ?")
        params.append(payload.role)

    if payload.max_clearance_level is not None or payload.max_clearance_level is None:
        # allow explicit nulling
        fields.append("max_clearance_level = ?")
        params.append(payload.max_clearance_level)

    if payload.password:
        pw_hash = bcrypt.hashpw(payload.password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
        fields.append("password_hash = ?")
        params.append(pw_hash)

    if not fields:
        return {"updated": False}

    params.append(user_id)
    db.db_write(f"UPDATE users SET {', '.join(fields)}, updated_at = datetime('now') WHERE id = ?", params)
    return {"updated": True}


@router.delete("/users/{user_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_user(user_id: int, current=Depends(get_current_user)):
    if current["id"] == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")
    rows = db.db_read("SELECT id FROM users WHERE id = ?", (user_id,))
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    db.db_write("DELETE FROM users WHERE id = ?", (user_id,))
    return {"deleted": True}


class ResetPasswordIn(BaseModel):
    password: str


@router.post("/users/{user_id}/reset_password", status_code=204, dependencies=[Depends(require_admin)])
def reset_password(user_id: int, payload: ResetPasswordIn):
    rows = db.db_read("SELECT id FROM users WHERE id = ?", (user_id,))
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    pw_hash = bcrypt.hashpw(payload.password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    db.db_write("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?", (pw_hash, user_id))
    return {"reset": True}
