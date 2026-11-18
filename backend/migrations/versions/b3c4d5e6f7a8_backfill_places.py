"""backfill modern, burial and marriage places

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-11-15 16:00:00.000000

旧版数据库只有 historical birth_place；这条数据迁移把已有的
birth_place_modern 补齐，并从人物小传的“葬于…”“出嫁/出阁…”提取
安葬地和出嫁地；没有明确出嫁地的女性按丈夫地点推断。
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _norm(address: str) -> str:
    s = (address or '').strip()
    if '安乐' in s:
        return '贵州省毕节市大方县安乐彝族仡佬族乡'
    if '核桃' in s:
        return '贵州省毕节市大方县核桃彝族白族乡'
    if '响水' in s or '以拉' in s:
        return '贵州省毕节市大方县响水乡'
    if any(k in s for k in ('撮坝', '晏塘', '高炉')):
        return '贵州省毕节市大方县百纳彝族乡'
    if any(k in s for k in ('路布', '沙坝')):
        return '贵州省毕节市大方县瓢井镇'
    if '戈厂' in s:
        return '贵州省毕节市大方县达溪镇'
    if any(k in s for k in ('东关', '空桐', '罗寨', '大水井', '彭家', '安东', '烂田湾', '上空')):
        return '贵州省毕节市大方县东关乡'
    return '贵州省毕节市大方县'


def upgrade() -> None:
    bind = op.get_bind()
    map_file = Path(__file__).resolve().parents[1] / 'data' / 'place-map-20261114.json'
    mapping = json.loads(map_file.read_text(encoding='utf-8')) if map_file.exists() else {}

    persons = [dict(r) for r in bind.execute(text(
        'select id, gender, is_living, birth_place, birth_place_modern, burial_place, '
        'marriage_place, marriage_inferred, bio, residence from persons'
    )).mappings()]
    by_id = {p['id']: p for p in persons}

    # 1) 补旧出生地的今地名
    for p in persons:
        if not p.get('birth_place_modern') and p.get('birth_place'):
            modern = mapping.get(p['birth_place'])
            if modern:
                bind.execute(text('update persons set birth_place_modern=:v where id=:id'),
                             {'v': modern, 'id': p['id']})
                p['birth_place_modern'] = modern

    # 2) 安葬地 / 明确出嫁地
    for p in persons:
        bio = p.get('bio') or ''
        burial = None
        m = re.search(r'葬于([^，。；\n]+)', bio)
        if m:
            burial = _norm(m.group(1))
        explicit = None
        m = re.search(r'(?:出嫁|出阁)([^，。；\n]+)', bio)
        if m:
            explicit = _norm(m.group(1))
        if burial and not p.get('burial_place'):
            p['burial_place'] = burial
        if explicit and not p.get('marriage_place'):
            p['marriage_place'] = explicit
            p['marriage_inferred'] = False

    # 3) 没有明确出嫁地的女性，用丈夫的现居地/出生地推断
    spouse_pairs = []
    for r in bind.execute(text(
        'select r.person_a_id a, r.person_b_id b from relationships r '
        "join relation_types t on t.id=r.type_id where t.kinship_role='spouse' "
        "and (r.status is null or r.status<>'ended')"
    )).mappings():
        spouse_pairs.append((r['a'], r['b']))

    spouse_map: dict[int, list[int]] = {}
    for a, b in spouse_pairs:
        spouse_map.setdefault(a, []).append(b)
        spouse_map.setdefault(b, []).append(a)

    for p in persons:
        if p['gender'] != 'female' or p.get('marriage_place'):
            continue
        candidates = []
        for sid in spouse_map.get(p['id'], []):
            sp = by_id.get(sid)
            if not sp or sp['gender'] != 'male':
                continue
            place = (sp.get('residence') or '').strip() or (sp.get('birth_place_modern') or '').strip()
            if place:
                candidates.append((0 if sp.get('residence') else 1, sid, place))
        if candidates:
            candidates.sort()
            p['marriage_place'] = candidates[0][2]
            p['marriage_inferred'] = True

    for p in persons:
        bind.execute(text(
            'update persons set burial_place=:b, marriage_place=:m, marriage_inferred=:i where id=:id'
        ), {'b': p.get('burial_place'), 'm': p.get('marriage_place'),
            'i': bool(p.get('marriage_inferred')), 'id': p['id']})


def downgrade() -> None:
    # 回填数据无法可靠还原，保留字段值
    pass
