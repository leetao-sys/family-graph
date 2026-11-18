"""persons.honorific: 封赠 / 功名（如 例赠登仕郎）

Revision ID: e6f8b0c2d534
Revises: c5e7a9b1d423
Create Date: 2026-11-08 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e6f8b0c2d534'
down_revision: Union[str, Sequence[str], None] = 'c5e7a9b1d423'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('persons') as b:
        b.add_column(sa.Column('honorific', sa.String(length=128), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('persons') as b:
        b.drop_column('honorific')
