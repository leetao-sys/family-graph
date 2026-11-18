"""seed the curated genealogy articles

Revision ID: g7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-11-19 06:50:00.000000

把整理后的 23 篇文章作为初始内容写入：仅当标题不存在时插入，
不覆盖部署环境里已有的同题文章。
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = 'g7b8c9d0e1f2'
down_revision: Union[str, Sequence[str], None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    data_file = Path(__file__).resolve().parents[1] / 'data' / 'articles-20261118.json'
    if not data_file.exists():
        return
    articles = json.loads(data_file.read_text(encoding='utf-8'))
    existing = {r[0] for r in bind.execute(text('select title from articles'))}
    author = bind.execute(text('select id from users order by id limit 1')).scalar()
    for a in articles:
        if a['title'] in existing:
            continue
        bind.execute(text(
            'insert into articles(title,summary,content,format,author_id,created_at,updated_at) '
            'values(:title,:summary,:content,:format,:author, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
        ), {'title': a['title'], 'summary': a.get('summary'), 'content': a.get('content', ''),
            'format': a.get('format', 'markdown'), 'author': author})
        existing.add(a['title'])


def downgrade() -> None:
    pass
