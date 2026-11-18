"""map Lanwan group to current address

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-11-16 00:55:00.000000
"""
from typing import Sequence, Union
from datetime import datetime, timezone

from alembic import op
from sqlalchemy import text


revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ADDRESS = '贵州省毕节市大方县瓢井镇新街村烂湾组'
OLD_NEW_STREET = '贵州省毕节市大方县瓢井镇新街村'


def upgrade() -> None:
    bind = op.get_bind()
    terms = " (birth_place like '%烂田湾%' or birth_place like '%烂湾组%') "
    bind.execute(text(
        f"update persons set birth_place_modern=:a where {terms}"
    ), {'a': ADDRESS})
    bind.execute(text(
        "update persons set burial_place=:a where is_living=false and burial_place is not null "
        "and (bio like '%烂田湾%' or bio like '%烂湾组%')"
    ), {'a': ADDRESS})
    # 明确“出客/出嫁/出阁”的宾语写烂田湾或烂湾组的女性
    bind.execute(text(
        "update persons set marriage_place=:a, marriage_inferred=false where gender='female' "
        "and (bio like '%出客烂%' or bio like '%出嫁烂%' or bio like '%出阁烂%')"
    ), {'a': ADDRESS})
    # 已按丈夫新街村地点推断的女性，随丈夫所在组修正
    bind.execute(text(
        "update persons set marriage_place=:a where gender='female' "
        "and marriage_inferred=true and marriage_place=:old"
    ), {'a': ADDRESS, 'old': OLD_NEW_STREET})

    exists = bind.execute(text('select 1 from places where address=:a'), {'a': ADDRESS}).first()
    if exists:
        bind.execute(text('update places set lat=:lat, lng=:lng, formatted=:f where address=:a'),
                     {'lat': 27.410209, 'lng': 105.760145, 'f': ADDRESS, 'a': ADDRESS})
    else:
        bind.execute(text(
            'insert into places(address,lat,lng,formatted,updated_by,updated_at) '
            'values(:a,:lat,:lng,:f,null,:t)'
        ), {'a': ADDRESS, 'lat': 27.410209, 'lng': 105.760145, 'f': ADDRESS,
            't': datetime.now(timezone.utc).isoformat()})


def downgrade() -> None:
    pass
