import os
import sys
import pathlib

# Make the repo root importable so `import shared.oidb` works.
ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest_asyncio  # noqa: E402

from shared.oidb.adapter import SQLiteAdapter, PostgresAdapter  # noqa: E402
from shared.oidb.repository import Repository  # noqa: E402


def _backends():
    """Backends to exercise. SQLite always; Postgres only if TEST_DATABASE_URL
    is provided (so CI/local without a DB still runs the SQLite suite)."""
    backends = ["sqlite"]
    if os.getenv("TEST_DATABASE_URL"):
        backends.append("postgres")
    return backends


@pytest_asyncio.fixture(params=_backends())
async def repo(request, tmp_path):
    backend = request.param
    if backend == "sqlite":
        adapter = SQLiteAdapter(str(tmp_path / "test.db"))
    else:
        adapter = PostgresAdapter(os.environ["TEST_DATABASE_URL"])

    r = Repository(adapter)
    await r.connect()
    if backend == "postgres":
        # isolate from any existing data
        await adapter.execute("DROP TABLE IF EXISTS api_logs")
        await adapter.execute("DROP TABLE IF EXISTS settings")
        await adapter.execute("DROP TABLE IF EXISTS apps")
    await r.ensure_schema()
    yield r
    await r.close()
