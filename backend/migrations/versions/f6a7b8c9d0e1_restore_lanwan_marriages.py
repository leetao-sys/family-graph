"""restore Zhongzhai and Zhongdong marriages after Lanwan overreach

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-11-16 01:05:00.000000
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    # 255 李云：出生于烂田湾，但出嫁地是路布中寨
    bind.execute(text(
        "update persons set marriage_place=:a, marriage_inferred=false where id=255"
    ), {'a': '贵州省毕节市大方县瓢井镇中寨村'})
    # 256 李琴、257 李铃：出生于烂田湾，但出嫁地是中洞
    bind.execute(text(
        "update persons set marriage_place=:a, marriage_inferred=false where id in (256,257)"
    ), {'a': '贵州省毕节市大方县瓢井镇中洞村'})


def downgrade() -> None:
    pass
