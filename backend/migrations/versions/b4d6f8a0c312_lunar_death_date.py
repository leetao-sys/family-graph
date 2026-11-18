"""lunar death date: death_lunar, death_lunar_leap, death_hour

Revision ID: b4d6f8a0c312
Revises: a3c5e7f9b201
Create Date: 2026-11-07 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b4d6f8a0c312'
down_revision: Union[str, Sequence[str], None] = 'a3c5e7f9b201'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('persons') as b:
        b.add_column(sa.Column('death_lunar', sa.Boolean(), nullable=False, server_default=sa.false()))
        b.add_column(sa.Column('death_lunar_leap', sa.Boolean(), nullable=False, server_default=sa.false()))
        b.add_column(sa.Column('death_hour', sa.String(length=2), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('persons') as b:
        b.drop_column('death_hour')
        b.drop_column('death_lunar_leap')
        b.drop_column('death_lunar')
