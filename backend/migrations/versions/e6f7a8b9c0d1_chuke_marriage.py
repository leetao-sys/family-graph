"""extract marriage places from 出客 records and fill current places

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-11-15 22:45:00.000000
"""
from typing import Sequence, Union
from datetime import datetime, timezone

from alembic import op
from sqlalchemy import text


revision: str = 'e6f7a8b9c0d1'
down_revision: Union[str, Sequence[str], None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PLACES = (
    ('贵州省贵阳市清镇市', 26.556, 106.470, '贵州省贵阳市清镇市'),
    ('贵州省六盘水市盘州市', 25.713, 104.470, '贵州省六盘水市盘州市'),
    ('贵州省毕节市百里杜鹃管理区普底彝族苗族白族乡', 27.180, 105.860, '贵州省毕节市百里杜鹃管理区普底彝族苗族白族乡'),
    ('湖南省株洲市炎陵县', 26.489, 113.772, '湖南省株洲市炎陵县'),
    ('湖北省孝感市大悟县', 31.561, 114.127, '湖北省孝感市大悟县'),
    ('重庆市', 29.563, 106.551, '重庆市'),
    ('安徽省', 31.861, 117.285, '安徽省'),
    ('江苏省', 32.061, 118.796, '江苏省'),
)


def norm(text: str) -> str:
    s = text or ''
    if '雨圈' in s or '漆树湾' in s:
        return '贵州省毕节市大方县瓢井镇雨圈村漆树湾组'
    if '家嘎' in s:
        return '贵州省毕节市大方县瓢井镇三合村家嘎组'
    if '中洞' in s:
        return '贵州省毕节市大方县瓢井镇中洞村'
    if '烂湾组' in s or '烂田湾' in s:
        return '贵州省毕节市大方县瓢井镇新街村烂湾组'
    if '东关' in s or '空桐' in s:
        return '贵州省毕节市大方县东关乡'
    if '三元' in s or '法塔' in s:
        return '贵州省毕节市大方县三元彝族苗族白族乡'
    if any(k in s for k in ('撮坝', '糯嘎', '晏塘', '红岩', '蒋家')):
        return '贵州省毕节市大方县百纳彝族乡'
    if any(k in s for k in ('核桃', '高觐', '白泥', '新寨')):
        return '贵州省毕节市大方县核桃彝族白族乡'
    if any(k in s for k in ('戈厂', '木弄关', '水洞')):
        return '贵州省毕节市大方县达溪镇'
    if any(k in s for k in ('马干山', '凤山', '牧垦')):
        return '贵州省毕节市大方县凤山彝族蒙古族乡'
    if '白石' in s:
        return '贵州省毕节市大方县九驿街道白石社区'
    if any(k in s for k in ('五凤', '坝子', '六龙')):
        return '贵州省毕节市大方县六龙镇坝子社区'
    if '响水' in s or '以拉' in s or '坡头上' in s:
        return '贵州省毕节市大方县响水乡'
    if '贵阳' in s:
        return '贵州省贵阳市'
    if '安乐' in s:
        return '贵州省毕节市大方县安乐彝族仡佬族乡'
    if '清镇' in s:
        return '贵州省贵阳市清镇市'
    if '盘县' in s or '盘州' in s:
        return '贵州省六盘水市盘州市'
    if '百管委' in s or '普底' in s:
        return '贵州省毕节市百里杜鹃管理区普底彝族苗族白族乡'
    if '毕节海子街' in s or '海子街' in s:
        return '贵州省毕节市七星关区海子街镇'
    if '锅厂' in s:
        return '贵州省毕节市大方县核桃彝族白族乡营光村'
    if ('路布' in s or '瓢井' in s) and '中寨' in s:
        return '贵州省毕节市大方县瓢井镇中寨村'
    if '瓢井' in s or '路布' in s:
        return '贵州省毕节市大方县瓢井镇'
    if '重庆' in s:
        return '重庆市'
    if '湖南' in s:
        return '湖南省株洲市炎陵县'
    if '湖北' in s:
        return '湖北省孝感市大悟县'
    if '安徽' in s:
        return '安徽省'
    if '江苏' in s:
        return '江苏省'
    return '贵州省毕节市大方县'


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(text(
        "select id, bio from persons where bio like '%出客%' and (marriage_place is null or trim(marriage_place)='' or marriage_inferred=true)"
    )).mappings().all()
    for r in rows:
        bio = r['bio'] or ''
        marker = bio.find('出客')
        if marker < 0:
            continue
        tail = bio[marker + 2:]
        # 去掉“于/在/到”等介词，取到第一个标点
        tail = tail.lstrip('于在到')
        place = tail.split('，')[0].split('。')[0].split('；')[0].split('\n')[0].strip()
        if not place:
            continue
        bind.execute(text(
            'update persons set marriage_place=:p, marriage_inferred=false where id=:id'
        ), {'p': norm(place), 'id': r['id']})

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
