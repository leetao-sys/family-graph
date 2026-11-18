"""refine explicit marriage places to current villages

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-11-15 22:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text
from datetime import datetime, timezone


revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, Sequence[str], None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PLACES = (
    ('贵州省毕节市大方县核桃彝族白族乡营光村', 27.278376, 105.642696,
     '贵州省毕节市大方县核桃彝族白族乡营光村'),
    ('贵州省毕节市大方县九驿街道余石社区', 27.143976, 105.60816,
     '贵州省毕节市大方县九驿街道余石社区'),
)


def upgrade() -> None:
    bind = op.get_bind()
    # 新关村 2003 年并入营光村；余石村现为九驿街道余石社区
    bind.execute(text(
        "update persons set marriage_place=:v where bio like '%新关%' "
        "and marriage_place='贵州省毕节市大方县核桃彝族白族乡'"
    ), {'v': PLACES[0][0]})
    bind.execute(text(
        "update persons set marriage_place=:v where bio like '%余石%' "
        "and marriage_place='贵州省毕节市大方县'"
    ), {'v': PLACES[1][0]})

    for address, lat, lng, formatted in PLACES:
        exists = bind.execute(text('select 1 from places where address=:a'), {'a': address}).first()
        if exists:
            bind.execute(text(
                'update places set lat=:lat, lng=:lng, formatted=:f where address=:a'
            ), {'lat': lat, 'lng': lng, 'f': formatted, 'a': address})
        else:
            bind.execute(text(
                'insert into places(address, lat, lng, formatted, updated_by, updated_at) '
                'values(:a, :lat, :lng, :f, null, :t)'
            ), {'a': address, 'lat': lat, 'lng': lng, 'f': formatted,
                't': datetime.now(timezone.utc).isoformat()})


def downgrade() -> None:
    pass
