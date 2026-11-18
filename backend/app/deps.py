from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .db import get_db
from .models import User
from .security import COOKIE_NAME, decode_token


def _load_user(request: Request, db: Session) -> User:
    token = request.cookies.get(COOKIE_NAME)
    payload = decode_token(token) if token else None
    if not payload:
        raise HTTPException(401, "未登录或登录已过期")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active or user.token_version != payload.get("tv"):
        raise HTTPException(401, "未登录或登录已过期")
    return user


def current_user_allow_pending(request: Request, db: Session = Depends(get_db)) -> User:
    """允许“需修改初始密码”状态的用户（仅用于认证相关接口）。"""
    return _load_user(request, db)


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = _load_user(request, db)
    if user.must_change_password:
        raise HTTPException(403, "请先修改初始密码")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "需要管理员权限")
    return user
