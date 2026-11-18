"""refresh female marriage places after Lantianwan address correction

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-11-16 00:25:00.000000
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

XINJIE = '贵州省毕节市大方县瓢井镇新街村'


def upgrade() -> None:
    bind = op.get_bind()
    # 李声云：出客烂田湾组徐家，明确出嫁地
    bind.execute(text(
        "update persons set marriage_place=:a, marriage_inferred=false where id=277"
    ), {'a': XINJIE})
    # 配偶地点原在烂田湾、按旧地址推断的女性
    bind.execute(text(
        "update persons set marriage_place=:a "
        "where id in (259,261,267,272,276,279,285) and marriage_inferred=true"
    ), {'a': XINJIE})


def downgrade() -> None:
    pass
