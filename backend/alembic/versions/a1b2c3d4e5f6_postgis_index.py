"""Optional PostGIS extension + geography GiST index for fast nearby-driver search.

Runs only on PostgreSQL. If PostGIS isn't installed on the server it is skipped
(the app then falls back to bounding-box + haversine search).

Revision ID: a1b2c3d4e5f6
Revises: 3049357fe561
"""
from alembic import op
from sqlalchemy import text

revision = "a1b2c3d4e5f6"
down_revision = "3049357fe561"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    available = bind.execute(text("SELECT 1 FROM pg_available_extensions WHERE name = 'postgis'")).scalar()
    if not available:
        return
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_drivers_geog ON drivers "
        "USING GIST ((ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography))"
    )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_drivers_geog")
