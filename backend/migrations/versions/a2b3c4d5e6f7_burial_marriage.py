"""person burial and marriage places

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-11-15 15:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = [c["name"] for c in inspect(bind).get_columns("persons")]
    if "burial_place" not in cols:
        op.add_column("persons", sa.Column("burial_place", sa.String(length=128), nullable=True))
    if "marriage_place" not in cols:
        op.add_column("persons", sa.Column("marriage_place", sa.String(length=128), nullable=True))
    if "marriage_inferred" not in cols:
        op.add_column("persons", sa.Column("marriage_inferred", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    bind = op.get_bind()
    cols = [c["name"] for c in inspect(bind).get_columns("persons")]
    for name in ("marriage_inferred", "marriage_place", "burial_place"):
        if name in cols:
            op.drop_column("persons", name)
