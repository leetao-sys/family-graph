"""v2: articles, lunar birthday details, bio format, relationship visibility

Revision ID: a3c5e7f9b201
Revises: d17dc63f2b54
Create Date: 2026-11-07 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a3c5e7f9b201'
down_revision: Union[str, Sequence[str], None] = 'd17dc63f2b54'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('persons') as b:
        b.add_column(sa.Column('birth_lunar_leap', sa.Boolean(), nullable=False, server_default=sa.false()))
        b.add_column(sa.Column('birth_hour', sa.String(length=2), nullable=True))
        b.add_column(sa.Column('bio_format', sa.String(length=8), nullable=False, server_default='markdown'))
    # 已有关系保持公开，避免升级后数据“消失”；新建社会关系默认仅自己可见（由应用层默认值决定）
    with op.batch_alter_table('relationships') as b:
        b.add_column(sa.Column('is_public', sa.Boolean(), nullable=False, server_default=sa.true()))
    op.create_table(
        'articles',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=128), nullable=False),
        sa.Column('summary', sa.String(length=256), nullable=True),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('format', sa.String(length=8), nullable=False),
        sa.Column('author_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_articles_author_id', 'articles', ['author_id'])
    op.create_index('ix_articles_created_at', 'articles', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_articles_created_at', table_name='articles')
    op.drop_index('ix_articles_author_id', table_name='articles')
    op.drop_table('articles')
    with op.batch_alter_table('relationships') as b:
        b.drop_column('is_public')
    with op.batch_alter_table('persons') as b:
        b.drop_column('bio_format')
        b.drop_column('birth_hour')
        b.drop_column('birth_lunar_leap')
