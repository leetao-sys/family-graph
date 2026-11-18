"""fix Lantianwan burial place

Revision ID: a1b2c3d4e5f6
Revises: f8a9b0c1d2e3
Create Date: 2026-11-15 23:55:00.000000
"""
from typing import Sequence, Union
from datetime import datetime, timezone

from alembic import op
from sqlalchemy import text


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'f8a9b0c1d2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ADDRESS = '贵州省毕节市大方县瓢井镇新街村'
LAT, LNG = 27.410209, 105.760145


def upgrade() -> None:
    bind = op.get_bind()
    # 旧小传里的“烂田湾生产队”属瓢井镇新街村，纠正此前误归到东关乡的安葬地
    bind.execute(text(
        "update persons set burial_place=:a where is_living=false and burial_place is not null "
        "and (bio like '%烂田湾%' or burial_place like '%烂田湾%')"
    ), {'a': ADDRESS})
    exists = bind.execute(text('select 1 from places where address=:a'), {'a': ADDRESS}).first()
    if exists:
        bind.execute(text('update places set lat=:lat, lng=:lng, formatted=:f where address=:a'),
                     {'lat': LAT, 'lng': LNG, 'f': ADDRESS, 'a': ADDRESS})
    else:
        bind.execute(text(
            'insert into places(address,lat,lng,formatted,updated_by,updated_at) '
            'values(:a,:lat,:lng,:f,null,:t)'
        ), {'a': ADDRESS, 'lat': LAT, 'lng': LNG, 'f': ADDRESS,
            't': datetime.now(timezone.utc).isoformat()})


def downgrade() -> None:
    pass
