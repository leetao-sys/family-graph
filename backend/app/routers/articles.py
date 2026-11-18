"""文章管理：所有成员可阅读与发表，作者本人或管理员可修改、删除。"""
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..deps import admin_user, current_user
from ..models import Article, Person, User
from ..schemas import ArticleImportIn, ArticleIn

router = APIRouter(prefix="/api", tags=["文章"])

_INLINE_TAG_RE = re.compile(r"</?(strong|b|em|i|u|s|del|a|span|code|sub|sup|mark)\b[^>]*>", re.I)
_TAG_RE = re.compile(r"<[^>]+>")
_MD_LINK_RE = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_MD_RE = re.compile(r"[#*_`>|~]+|^\s*([-+]|\d+\.)\s", re.M)


def _excerpt(a: Article, n: int = 120) -> str:
    if a.summary:
        return a.summary
    content = a.content or ""
    if a.format == "html":
        text = _TAG_RE.sub(" ", _INLINE_TAG_RE.sub("", content))
    else:
        text = _MD_RE.sub("", _MD_LINK_RE.sub(r"\1", content))
    text = re.sub(r"\s+", " ", text.replace("&nbsp;", " ")).strip()
    return text[:n] + ("…" if len(text) > n else "")


def _authors(db: Session, ids) -> dict[int, dict]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = db.execute(
        select(User.id, User.username, Person.surname, Person.given_name)
        .outerjoin(Person, Person.id == User.person_id)
        .where(User.id.in_(ids))
    ).all()
    return {r.id: {"id": r.id, "name": f"{r.surname or ''}{r.given_name or ''}" or r.username} for r in rows}


def _out(a: Article, user: User, authors: dict, full: bool) -> dict:
    out = {
        "id": a.id,
        "title": a.title,
        "summary": a.summary,
        "excerpt": _excerpt(a),
        "format": a.format,
        "author": authors.get(a.author_id) or {"id": None, "name": "已删除用户"},
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
        "can_edit": user.role == "admin" or (a.author_id is not None and a.author_id == user.id),
    }
    if full:
        out["content"] = a.content
    return out


def _load(db: Session, aid: int) -> Article:
    a = db.get(Article, aid)
    if not a:
        raise HTTPException(404, "文章不存在")
    return a


def _editable(db: Session, aid: int, user: User) -> Article:
    a = _load(db, aid)
    if user.role != "admin" and a.author_id != user.id:
        raise HTTPException(403, "只能修改自己发表的文章")
    return a


@router.get("/articles")
def list_articles(
    q: str | None = None,
    mine: bool = False,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Article)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Article.title.like(like), Article.content.like(like)))
    if mine:
        stmt = stmt.where(Article.author_id == user.id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(Article.updated_at.desc(), Article.id.desc()).offset((page - 1) * size).limit(size)).all()
    authors = _authors(db, (a.author_id for a in rows))
    return {"total": total, "items": [_out(a, user, authors, full=False) for a in rows]}


@router.get("/articles/export")
def export_articles(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Article).order_by(Article.id)).all()
    return {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "articles": [
            {
                "id": a.id,
                "title": a.title,
                "summary": a.summary,
                "content": a.content,
                "format": a.format,
                "created_at": a.created_at.isoformat() if a.created_at else None,
                "updated_at": a.updated_at.isoformat() if a.updated_at else None,
            }
            for a in rows
        ],
    }


@router.post("/articles/import")
def import_articles(body: ArticleImportIn, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    existing = {a.title: a for a in db.scalars(select(Article)).all()}
    created = updated = 0
    for item in body.articles:
        data = item.model_dump()
        article = existing.get(data["title"])
        if article:
            article.summary = data["summary"]
            article.content = data["content"]
            article.format = data["format"]
            updated += 1
        else:
            article = Article(**data, author_id=user.id)
            db.add(article)
            db.flush()
            existing[data["title"]] = article
            created += 1
    audit.record(db, user, "import", "article", None,
                 f"导入文章 {len(body.articles)} 篇（新增 {created}、更新 {updated}）")
    db.commit()
    return {"ok": True, "created": created, "updated": updated, "total": len(body.articles)}


@router.get("/articles/{aid}")
def get_article(aid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = _load(db, aid)
    return _out(a, user, _authors(db, [a.author_id]), full=True)


@router.post("/articles", status_code=201)
def create_article(body: ArticleIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = Article(**body.model_dump(), author_id=user.id)
    db.add(a)
    db.flush()
    audit.record(db, user, "create", "article", a.id, f"发表文章《{a.title}》")
    db.commit()
    return _out(a, user, _authors(db, [a.author_id]), full=True)


@router.put("/articles/{aid}")
def update_article(aid: int, body: ArticleIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = _editable(db, aid, user)
    before = {"title": a.title, "summary": a.summary, "format": a.format}
    for k, v in body.model_dump().items():
        setattr(a, k, v)
    audit.record(db, user, "update", "article", a.id, f"修改文章《{a.title}》", before,
                 {"title": a.title, "summary": a.summary, "format": a.format})
    db.commit()
    return _out(a, user, _authors(db, [a.author_id]), full=True)


@router.delete("/articles/{aid}")
def delete_article(aid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = _editable(db, aid, user)
    audit.record(db, user, "delete", "article", a.id, f"删除文章《{a.title}》", before={"title": a.title})
    db.delete(a)
    db.commit()
    return {"ok": True}
