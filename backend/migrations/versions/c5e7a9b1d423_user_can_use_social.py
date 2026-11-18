"""users.can_use_social: social relationships are an opt-in feature per account

Revision ID: c5e7a9b1d423
Revises: b4d6f8a0c312
Create Date: 2026-11-08 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c5e7a9b1d423'
down_revision: Union[str, Sequence[str], None] = 'b4d6f8a0c312'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users') as b:
        b.add_column(sa.Column('can_use_social', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table('users') as b:
        b.drop_column('can_use_social')
