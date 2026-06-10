"""Low-level async database adapters for OpenInspector.

Two backends are supported:
  * ``postgres`` — via asyncpg (the default, production backend)
  * ``sqlite``   — via aiosqlite (lightweight, single-file, WAL mode)

All SQL in the Repository is written with ``?`` placeholders (qmark style).
The Postgres adapter rewrites them to ``$1, $2, …`` on the way out, so callers
never deal with placeholder dialects. Values are always passed positionally,
matching the ``?`` count (a value used twice appears twice in the args).

Rows are returned as plain ``dict``s for both backends.
"""

import os
import re
import asyncio
import datetime as _dt
from typing import Any, Optional


def _utcnow() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


_QMARK_RE = re.compile(r"\?|'(?:[^']|'')*'")


def _qmark_to_numeric(sql: str) -> str:
    """Rewrite ``?`` placeholders to ``$1, $2, …`` for asyncpg, leaving any
    ``?`` that appears inside a single-quoted string literal untouched."""
    counter = {"n": 0}

    def repl(m: re.Match) -> str:
        tok = m.group(0)
        if tok == "?":
            counter["n"] += 1
            return f"${counter['n']}"
        return tok  # quoted literal — pass through verbatim

    return _QMARK_RE.sub(repl, sql)


class Adapter:
    """Base class. Subclasses set ``backend`` and implement the I/O methods."""

    backend: str = ""

    async def connect(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    async def close(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    async def execute(self, sql: str, *args: Any) -> int:  # pragma: no cover
        raise NotImplementedError

    async def fetch(self, sql: str, *args: Any) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def fetchrow(self, sql: str, *args: Any) -> Optional[dict]:  # pragma: no cover
        raise NotImplementedError

    async def fetchval(self, sql: str, *args: Any) -> Any:  # pragma: no cover
        raise NotImplementedError

    # --- value helpers (dialect-aware) ---
    def ts_param(self, dt: Optional[_dt.datetime] = None) -> Any:
        """Return a timestamp value suitable for binding on this backend.
        Postgres wants a tz-aware ``datetime``; SQLite stores ISO-8601 text."""
        dt = dt or _utcnow()
        return dt if self.backend == "postgres" else dt.isoformat()

    @staticmethod
    def iso(value: Any) -> Optional[str]:
        """Normalise a timestamp column (datetime or str) to an ISO string."""
        if value is None:
            return None
        if isinstance(value, (_dt.datetime, _dt.date)):
            return value.isoformat()
        return str(value)


class PostgresAdapter(Adapter):
    backend = "postgres"

    def __init__(self, dsn: str):
        self._dsn = dsn
        self._pool = None

    async def connect(self) -> None:
        import asyncpg
        self._pool = await asyncpg.create_pool(self._dsn)

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()

    async def execute(self, sql: str, *args: Any) -> int:
        status = await self._pool.execute(_qmark_to_numeric(sql), *args)
        # status is like "DELETE 3" / "UPDATE 2" / "INSERT 0 1" / "CREATE TABLE"
        try:
            return int(status.split()[-1])
        except (ValueError, AttributeError, IndexError):
            return -1

    async def fetch(self, sql: str, *args: Any) -> list[dict]:
        rows = await self._pool.fetch(_qmark_to_numeric(sql), *args)
        return [dict(r) for r in rows]

    async def fetchrow(self, sql: str, *args: Any) -> Optional[dict]:
        row = await self._pool.fetchrow(_qmark_to_numeric(sql), *args)
        return dict(row) if row is not None else None

    async def fetchval(self, sql: str, *args: Any) -> Any:
        return await self._pool.fetchval(_qmark_to_numeric(sql), *args)


class SQLiteAdapter(Adapter):
    backend = "sqlite"

    def __init__(self, path: str):
        self._path = path
        self._conn = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        import aiosqlite
        self._conn = await aiosqlite.connect(self._path)
        self._conn.row_factory = aiosqlite.Row
        # WAL: many concurrent readers + one writer across processes (the proxy
        # writes, the dashboard reads/writes). busy_timeout lets a blocked
        # writer wait rather than failing immediately.
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA busy_timeout=5000")
        await self._conn.execute("PRAGMA foreign_keys=ON")
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()

    async def execute(self, sql: str, *args: Any) -> int:
        async with self._lock:
            cur = await self._conn.execute(sql, args)
            rowcount = cur.rowcount
            await cur.close()
            await self._conn.commit()
            return rowcount

    async def fetch(self, sql: str, *args: Any) -> list[dict]:
        async with self._lock:
            cur = await self._conn.execute(sql, args)
            rows = await cur.fetchall()
            await cur.close()
        return [dict(r) for r in rows]

    async def fetchrow(self, sql: str, *args: Any) -> Optional[dict]:
        async with self._lock:
            cur = await self._conn.execute(sql, args)
            row = await cur.fetchone()
            await cur.close()
        return dict(row) if row is not None else None

    async def fetchval(self, sql: str, *args: Any) -> Any:
        row = await self.fetchrow(sql, *args)
        if row is None:
            return None
        return next(iter(row.values()), None)


def _parse_backend() -> tuple[str, str]:
    """Resolve (backend, connection_target) from the environment.

    Precedence:
      1. DB_BACKEND env (``postgres`` | ``sqlite``)
      2. DATABASE_URL scheme (``postgresql://`` | ``sqlite:///``)
      3. default: postgres (preserves existing behaviour)
    """
    backend = (os.getenv("DB_BACKEND") or "").strip().lower()
    database_url = os.getenv("DATABASE_URL", "")

    if not backend and database_url:
        if database_url.startswith("sqlite"):
            backend = "sqlite"
        else:
            backend = "postgres"

    if not backend:
        backend = "postgres"

    if backend == "sqlite":
        # Accept sqlite:////abs/path.db, sqlite:///rel.db, or a bare path in
        # SQLITE_PATH; default to a shared volume location.
        path = os.getenv("SQLITE_PATH", "")
        if not path and database_url.startswith("sqlite"):
            path = database_url.split("://", 1)[1].lstrip("/")
            path = "/" + path if not path.startswith("/") else path
        if not path:
            path = "/data/openinspector.db"
        return "sqlite", path

    return "postgres", database_url


def make_adapter() -> Adapter:
    """Factory: build the configured adapter (not yet connected)."""
    backend, target = _parse_backend()
    if backend == "sqlite":
        return SQLiteAdapter(target)
    return PostgresAdapter(target)
