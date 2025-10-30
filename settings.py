from fastapi import APIRouter
from pydantic import BaseModel, EmailStr, conint, field_validator
import db

router = APIRouter(prefix="/api/settings", tags=["settings"])

class SettingsIn(BaseModel):
    admin_email: EmailStr
    reminder_freq_minutes: int = 180

    @field_validator("reminder_freq_minutes")
    def check_range(cls, v):
        if v <= 0 or v > 1440:
            raise ValueError("reminder_freq_minutes must be between 1 and 1440")
        return v

class SettingsOut(SettingsIn):
    pass

@router.get("", response_model=SettingsOut)
def read_settings():
    return SettingsOut(**db.get_settings())

@router.put("", response_model=SettingsOut)
def write_settings(payload: SettingsIn):
    db.update_settings(payload.admin_email, payload.reminder_freq_minutes)
    # Web app doesn't run the scheduler; worker will pick up changes.
    return SettingsOut(**db.get_settings())
