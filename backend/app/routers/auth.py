from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..config import settings
from ..db import get_db
from ..deps import current_user_allow_pending
from ..models import Person, User, utcnow
from ..schemas import ChangePasswordIn, LoginIn
from ..security import (
    COOKIE_NAME,
    create_token,
    hash_password,
    validate_password_strength,
    verify_password,
)
from ..services import person_brief

router = APIRouter(prefix="/api/auth", tags=["认证"])


def _set_cookie(response: Response, user: User) -> None:
    response.set_cookie(
        COOKIE_NAME,
        create_token(user.id, user.token_version),
        max_age=settings.token_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def user_out(db: Session, user: User) -> dict:
    person = db.get(Person, user.person_id) if user.person_id else None
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "person_id": user.person_id,
        "person": person_brief(person) if person else None,
        "must_change_password": user.must_change_password,
        "can_use_social": user.role == "admin" or bool(user.can_use_social),
    }


@router.post("/login")
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == body.username.strip()))
    now = utcnow()
    if user and user.locked_until and user.locked_until > now:
        minutes = int((user.locked_until - now).total_seconds() // 60) + 1
        raise HTTPException(429, f"登录失败次数过多，请 {minutes} 分钟后再试")
    if not user or not verify_password(body.password, user.password_hash):
        if user:
            user.failed_logins += 1
            if user.failed_logins >= settings.login_max_failures:
                user.locked_until = now + timedelta(minutes=settings.login_lock_minutes)
                user.failed_logins = 0
                audit.record(db, user, "lock", "user", user.id, "连续登录失败，账号临时锁定")
            db.commit()
        raise HTTPException(401, "用户名或密码错误")
    if not user.is_active:
        raise HTTPException(403, "账号已停用，请联系管理员")
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    audit.record(db, user, "login", "user", user.id, "登录")
    db.commit()
    _set_cookie(response, user)
    return user_out(db, user)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user_allow_pending), db: Session = Depends(get_db)):
    return user_out(db, user)


@router.post("/change-password")
def change_password(
    body: ChangePasswordIn,
    response: Response,
    user: User = Depends(current_user_allow_pending),
    db: Session = Depends(get_db),
):
    if not verify_password(body.old_password, user.password_hash):
        raise HTTPException(400, "原密码不正确")
    if body.old_password == body.new_password:
        raise HTTPException(400, "新密码不能与原密码相同")
    if err := validate_password_strength(body.new_password):
        raise HTTPException(400, err)
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    user.token_version += 1
    audit.record(db, user, "update", "user", user.id, "修改密码")
    db.commit()
    _set_cookie(response, user)
    return user_out(db, user)
