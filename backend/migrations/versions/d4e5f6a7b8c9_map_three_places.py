"""map Yujuan, Jiajia and Zhongdong to current villages

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-11-16 00:45:00.000000
"""
from typing import Sequence, Union
from datetime import datetime, timezone

from alembic import op
from sqlalchemy import text


revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

YUJUAN = '贵州省毕节市大方县瓢井镇雨圈村漆树湾组'
JIAJIA = '贵州省毕节市大方县瓢井镇三合村家嘎组'
ZHONGDONG = '贵州省毕节市大方县瓢井镇中洞村'


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(text(
        "update persons set birth_place_modern=:a where birth_place like '%雨圈村漆树湾组%'"
    ), {'a': YUJUAN})
    bind.execute(text(
        "update persons set birth_place_modern=:a where birth_place like '%路布乡家嘎组%'"
    ), {'a': JIAJIA})
    bind.execute(text(
        "update persons set birth_place_modern=:a where birth_place like '%中洞%'"
    ), {'a': ZHONGDONG})
    # 明确写“出客中洞…”的女性出嫁地
    bind.execute(text(
        "update persons set marriage_place=:a, marriage_inferred=false "
        "where gender='female' and bio like '%中洞%' "
        "and (bio like '%出客%' or bio like '%出嫁%' or bio like '%出阁%')"
    ), {'a': ZHONGDONG})

    for address, lat, lng in (
        (YUJUAN, 27.350492, 105.749794),
        (JIAJIA, 27.448083, 105.759577),
        (ZHONGDONG, 27.420536, 105.702917),
    ):
        exists = bind.execute(text('select 1 from places where address=:a'), {'a': address}).first()
        if exists:
            bind.execute(text('update places set lat=:lat, lng=:lng, formatted=:f where address=:a'),
                         {'lat': lat, 'lng': lng, 'f': address, 'a': address})
        else:
            bind.execute(text(
                'insert into places(address,lat,lng,formatted,updated_by,updated_at) '
                'values(:a,:lat,:lng,:f,null,:t)'
            ), {'a': address, 'lat': lat, 'lng': lng, 'f': address,
                't': datetime.now(timezone.utc).isoformat()})


def downgrade() -> None:
    pass
