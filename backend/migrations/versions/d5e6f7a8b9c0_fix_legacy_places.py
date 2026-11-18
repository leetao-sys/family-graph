"""fix legacy place names to current administrative names

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-11-15 22:30:00.000000
"""
from typing import Sequence, Union
from datetime import datetime, timezone

from alembic import op
from sqlalchemy import text


revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, Sequence[str], None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CORRECTIONS = {'遵义务川镇南新阳村下组': '贵州省遵义市务川仡佬族苗族自治县镇南镇', '大方县五风乡坝子寨': '贵州省毕节市大方县六龙镇坝子社区', '大定县阁丫后寨': '贵州省毕节市大方县东关乡阁丫社区', '大方县海马公社革新生产队': '贵州省毕节市大方县竹园彝族苗族乡海马宫村', '大方县岩下村上叶组': '贵州省毕节市大方县九驿街道岩下社区', '大方县白石村丫口三组老屋基': '贵州省毕节市大方县九驿街道白石社区', '大方镇白石村杉林组': '贵州省毕节市大方县九驿街道白石社区', '大方县锅厂': '贵州省毕节市大方县核桃彝族白族乡营光村', '大方高店乡沙子坡唐家湾': '贵州省毕节市大方县对江镇', '雨圈村漆树湾组': '贵州省毕节市大方县达溪镇雨卷村'}
PLACES = (('贵州省遵义市务川仡佬族苗族自治县镇南镇', 28.629736, 107.885884, '贵州省遵义市务川仡佬族苗族自治县镇南镇'), ('贵州省毕节市大方县六龙镇坝子社区', 27.312379, 105.604455, '贵州省毕节市大方县六龙镇坝子'), ('贵州省毕节市大方县东关乡阁丫社区', 27.197068, 105.576408, '贵州省毕节市大方县东关乡阁丫社区'), ('贵州省毕节市大方县竹园彝族苗族乡海马宫村', 27.238644, 105.583889, '贵州省毕节市大方县竹园彝族苗族乡海马宫村'), ('贵州省毕节市大方县九驿街道岩下社区', 27.143976, 105.60816, '贵州省毕节市大方县九驿街道'), ('贵州省毕节市大方县九驿街道白石社区', 27.143976, 105.60816, '贵州省毕节市大方县九驿街道'), ('贵州省毕节市大方县对江镇', 27.107229, 105.533657, '贵州省毕节市大方县对江镇'), ('贵州省毕节市大方县达溪镇雨卷村', 27.357525, 105.746827, '贵州省毕节市大方县达溪镇雨卷村'))


def upgrade() -> None:
    bind = op.get_bind()
    for old, new in CORRECTIONS.items():
        bind.execute(text('update persons set birth_place_modern=:new where birth_place=:old'),
                     {'old': old, 'new': new})
    # 旧小传里的海马宫、锅厂，补成现行行政村
    bind.execute(text("update persons set burial_place='贵州省毕节市大方县竹园彝族苗族乡海马宫村' "
                      "where burial_place='贵州省毕节市大方县' and bio like '%海马宫%'"))
    bind.execute(text("update persons set burial_place='贵州省毕节市大方县核桃彝族白族乡营光村' "
                      "where burial_place='贵州省毕节市大方县' and bio like '%锅厂%'"))
    for address, lat, lng, formatted in PLACES:
        exists = bind.execute(text('select 1 from places where address=:a'), {'a': address}).first()
        if exists:
            bind.execute(text('update places set lat=:lat, lng=:lng, formatted=:f where address=:a'),
                         {'lat': lat, 'lng': lng, 'f': formatted, 'a': address})
        else:
            bind.execute(text('insert into places(address,lat,lng,formatted,updated_by,updated_at) '
                              'values(:a,:lat,:lng,:f,null,:t)'),
                         {'a': address, 'lat': lat, 'lng': lng, 'f': formatted,
                           't': datetime.now(timezone.utc).isoformat()})


def downgrade() -> None:
    pass
