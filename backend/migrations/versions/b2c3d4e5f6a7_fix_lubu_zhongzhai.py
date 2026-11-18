"""fix Lubu Zhongzhai and Lantianwan modern addresses

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-11-16 00:10:00.000000
"""
from typing import Sequence, Union
from datetime import datetime, timezone

from alembic import op
from sqlalchemy import text


revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

XINJIE = '贵州省毕节市大方县瓢井镇新街村'
ZHONGZHAI = '贵州省毕节市大方县瓢井镇中寨村'


def upgrade() -> None:
    bind = op.get_bind()
    # 烂田湾属瓢井镇新街村，修正所有仍归到东关乡/只到瓢井镇的出生地今名
    bind.execute(text(
        "update persons set birth_place_modern=:a where birth_place like '%烂田湾%'"
    ), {'a': XINJIE})
    # 路布中寨属瓢井镇中寨村
    bind.execute(text(
        "update persons set marriage_place=:a, marriage_inferred=false "
        "where bio like '%路布中寨%' and gender='female'"
    ), {'a': ZHONGZHAI})

    for address, lat, lng in (
        (XINJIE, 27.410209, 105.760145),
        (ZHONGZHAI, 27.413965, 105.756246),
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
