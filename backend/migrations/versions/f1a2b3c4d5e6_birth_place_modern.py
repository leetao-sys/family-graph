"""person birth_place_modern

Revision ID: f1a2b3c4d5e6
Revises: e6f8b0c2d534
Create Date: 2026-11-14 22:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'e6f8b0c2d534'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = [c["name"] for c in inspect(bind).get_columns("persons")]
    if "birth_place_modern" not in cols:
        op.add_column("persons", sa.Column("birth_place_modern", sa.String(length=128), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    cols = [c["name"] for c in inspect(bind).get_columns("persons")]
    if "birth_place_modern" in cols:
        op.drop_column("persons", "birth_place_modern")
