"""Domain data-access for OpenInspector.

All SQL lives here (no inline SQL in the proxy or dashboard services). The
Repository owns the backend-specific translations — Postgres JSONB operators
vs SQLite JSON1 functions, ``FILTER`` vs ``CASE``, ``::jsonb`` casts, schema
DDL — behind a stable set of methods. Both services construct one Repository
over a connected Adapter.

SQL uses ``?`` placeholders throughout (the Postgres adapter rewrites them).
"""

import json
from typing import Any, Optional

from .adapter import Adapter


class DuplicateSlug(Exception):
    """Raised when creating/updating an app with an already-used slug."""


# Columns selected for the logs list (mirrors the original dashboard query).
_LOGS_COLUMNS = (
    "id, method, response_status_code, duration_sec, final_text, created_at, "
    "tool_calls, request_body_json, final_reasoning_text, app_slug"
)


class Repository:
    def __init__(self, adapter: Adapter):
        self.db = adapter
        self.backend = adapter.backend

    async def connect(self) -> None:
        await self.db.connect()

    async def close(self) -> None:
        await self.db.close()

    # ======================================================================
    # SCHEMA
    # ======================================================================

    async def ensure_schema(self) -> None:
        if self.backend == "postgres":
            await self._ensure_schema_postgres()
        else:
            await self._ensure_schema_sqlite()

    async def _ensure_schema_postgres(self) -> None:
        db = self.db
        await db.execute('''
            CREATE TABLE IF NOT EXISTS api_logs (
                id SERIAL PRIMARY KEY,
                url TEXT,
                method VARCHAR(10),
                query_params JSONB,
                request_headers JSONB,
                request_content_type VARCHAR(255),
                request_body_raw TEXT,
                request_body_json JSONB,
                response_status_code INTEGER,
                response_headers JSONB,
                response_content_type VARCHAR(255),
                response_body_raw TEXT,
                response_body_json JSONB,
                final_text TEXT,
                final_reasoning_text TEXT,
                tool_calls JSONB,
                duration_sec FLOAT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        ''')
        await db.execute('''
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='api_logs' AND column_name='app_slug'
                ) THEN
                    ALTER TABLE api_logs ADD COLUMN app_slug TEXT DEFAULT 'default';
                END IF;
            END $$;
        ''')
        await db.execute('CREATE INDEX IF NOT EXISTS idx_logs_body ON api_logs USING GIN (request_body_json)')
        await db.execute('CREATE INDEX IF NOT EXISTS idx_logs_tools ON api_logs USING GIN (tool_calls)')
        await db.execute('CREATE INDEX IF NOT EXISTS idx_logs_app_slug ON api_logs (app_slug)')
        await self._ensure_settings_apps_postgres()

    async def _ensure_settings_apps_postgres(self) -> None:
        await self.db.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        ''')
        await self.db.execute('''
            CREATE TABLE IF NOT EXISTS apps (
                id SERIAL PRIMARY KEY,
                slug TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                target_url TEXT NOT NULL,
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        ''')

    async def _ensure_schema_sqlite(self) -> None:
        db = self.db
        # api_logs already includes app_slug (fresh DB); the PRAGMA check below
        # is a no-op here but covers any pre-existing table.
        await db.execute('''
            CREATE TABLE IF NOT EXISTS api_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT,
                method TEXT,
                query_params TEXT,
                request_headers TEXT,
                request_content_type TEXT,
                request_body_raw TEXT,
                request_body_json TEXT,
                response_status_code INTEGER,
                response_headers TEXT,
                response_content_type TEXT,
                response_body_raw TEXT,
                response_body_json TEXT,
                final_text TEXT,
                final_reasoning_text TEXT,
                tool_calls TEXT,
                duration_sec REAL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                app_slug TEXT DEFAULT 'default'
            )
        ''')
        cols = await db.fetch("PRAGMA table_info(api_logs)")
        if not any(c["name"] == "app_slug" for c in cols):
            await db.execute("ALTER TABLE api_logs ADD COLUMN app_slug TEXT DEFAULT 'default'")
        await db.execute('CREATE INDEX IF NOT EXISTS idx_logs_app_slug ON api_logs (app_slug)')
        await db.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        await db.execute('''
            CREATE TABLE IF NOT EXISTS apps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                target_url TEXT NOT NULL,
                is_default INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')

    async def seed_initial(self, settings_seeds: dict, default_app: Optional[dict]) -> None:
        """Seed settings + a default app when those tables are empty. Only the
        proxy calls this (it holds the .env bootstrap values)."""
        if await self.db.fetchval("SELECT COUNT(*) FROM settings") == 0:
            for k, v in settings_seeds.items():
                if v:
                    await self.db.execute(
                        "INSERT INTO settings (key, value) VALUES (?, ?) "
                        "ON CONFLICT (key) DO NOTHING", k, str(v))
        if default_app and await self.db.fetchval("SELECT COUNT(*) FROM apps") == 0:
            # ON CONFLICT guards the rare race where two proxy workers seed at
            # the same time (slug is UNIQUE).
            await self.db.execute(
                "INSERT INTO apps (slug, name, target_url, is_default, created_at) "
                "VALUES (?, ?, ?, ?, ?) ON CONFLICT (slug) DO NOTHING",
                default_app["slug"], default_app["name"],
                default_app["target_url"], True, self.db.ts_param())

    # ======================================================================
    # CONFIG (used by the proxy's in-memory cache refresh)
    # ======================================================================

    async def fetch_settings_map(self) -> dict:
        rows = await self.db.fetch("SELECT key, value FROM settings")
        return {r["key"]: r["value"] for r in rows}

    async def fetch_apps(self) -> list[dict]:
        rows = await self.db.fetch(
            "SELECT id, slug, name, target_url, is_default FROM apps "
            "ORDER BY is_default DESC, name ASC")
        for r in rows:
            r["is_default"] = bool(r["is_default"])
        return rows

    # ======================================================================
    # LOG WRITE
    # ======================================================================

    async def insert_log(self, *, url, method, query_params, request_headers,
                         request_content_type, request_body_raw, request_body,
                         status_code, response_headers, response_content_type,
                         response_body_raw, response_body, final_text,
                         final_reasoning, tool_calls, duration_sec, app_slug) -> None:
        cols = (
            "url, method, query_params, request_headers, request_content_type, "
            "request_body_raw, request_body_json, response_status_code, "
            "response_headers, response_content_type, response_body_raw, "
            "response_body_json, final_text, final_reasoning_text, tool_calls, "
            "duration_sec, app_slug, created_at")
        if self.backend == "postgres":
            placeholders = ("?, ?, ?::jsonb, ?::jsonb, ?, ?, ?::jsonb, ?, "
                            "?::jsonb, ?, ?, ?::jsonb, ?, ?, ?::jsonb, ?, ?, ?")
        else:
            placeholders = ", ".join(["?"] * 18)
        await self.db.execute(
            f"INSERT INTO api_logs ({cols}) VALUES ({placeholders})",
            str(url), method, json.dumps(query_params),
            json.dumps(request_headers), request_content_type,
            request_body_raw, json.dumps(request_body), status_code,
            json.dumps(response_headers), response_content_type,
            response_body_raw, json.dumps(response_body), final_text,
            final_reasoning, json.dumps(tool_calls), duration_sec, app_slug,
            self.db.ts_param())

    # ======================================================================
    # METRICS
    # ======================================================================

    async def get_metrics(self, app_filter: str = "") -> dict:
        where = "WHERE 1=1"
        params: list = []
        if app_filter:
            params.append(app_filter)
            where += " AND app_slug = ?"

        if self.backend == "postgres":
            err = "COUNT(*) FILTER (WHERE response_status_code >= 400)"
        else:
            err = "COALESCE(SUM(CASE WHEN response_status_code >= 400 THEN 1 ELSE 0 END), 0)"

        summary = await self.db.fetchrow(
            f"SELECT COUNT(*) as total_requests, AVG(duration_sec) as avg_latency, "
            f"{err} as error_count FROM api_logs {where}", *params)

        daily = await self.db.fetch(
            f"SELECT DATE(created_at) as date, COUNT(*) as requests, "
            f"AVG(duration_sec) as latency FROM api_logs {where} "
            f"GROUP BY DATE(created_at) ORDER BY date ASC LIMIT 30", *params)
        for row in daily:
            row["date"] = self.db.iso(row["date"])

        breakdown = await self.db.fetch(
            f"SELECT COALESCE(app_slug, 'default') as app_slug, "
            f"COUNT(*) as total_requests, {err} as error_count "
            f"FROM api_logs GROUP BY app_slug ORDER BY total_requests DESC")

        return {"summary": summary, "chart_data": daily, "app_breakdown": breakdown}

    # ======================================================================
    # LOGS LIST
    # ======================================================================

    def _trace_parent_filter(self) -> str:
        """SQL fragment excluding follow-up turns (last message is a tool /
        tool_result), so only conversation roots show as rows."""
        if self.backend == "postgres":
            return """
                AND NOT (
                    jsonb_typeof(request_body_json->'messages') = 'array'
                    AND jsonb_array_length(request_body_json->'messages') > 0
                    AND (
                        request_body_json->'messages'->-1->>'role' = 'tool'
                        OR (
                            request_body_json->'messages'->-1->>'role' = 'user'
                            AND jsonb_typeof(request_body_json->'messages'->-1->'content') = 'array'
                            AND request_body_json->'messages'->-1->'content' @> '[{"type": "tool_result"}]'::jsonb
                        )
                    )
                )
            """
        # SQLite JSON1. Compute the last-element index by concatenation so we
        # avoid the '$.messages[#-1]' syntax (only available in SQLite >= 3.42).
        last = "(json_array_length(request_body_json, '$.messages') - 1)"
        role_path = f"'$.messages[' || {last} || '].role'"
        content_path = f"'$.messages[' || {last} || '].content'"
        return f"""
            AND NOT (
                json_type(request_body_json, '$.messages') = 'array'
                AND json_array_length(request_body_json, '$.messages') > 0
                AND (
                    json_extract(request_body_json, {role_path}) = 'tool'
                    OR (
                        json_extract(request_body_json, {role_path}) = 'user'
                        AND json_type(request_body_json, {content_path}) = 'array'
                        AND EXISTS (
                            SELECT 1 FROM json_each(request_body_json, {content_path})
                            WHERE json_extract(value, '$.type') = 'tool_result'
                        )
                    )
                )
            )
        """

    async def get_logs(self, *, limit: int, offset: int, search: str,
                       view: str, app_filter: str, status: str) -> tuple[int, list[dict]]:
        where = "WHERE 1=1"
        params: list = []

        if search:
            like = "ILIKE" if self.backend == "postgres" else "LIKE"
            text_cast = "::text" if self.backend == "postgres" else ""
            params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
            where += (f" AND (final_text {like} ? OR final_reasoning_text {like} ? "
                      f"OR request_body_json{text_cast} {like} ?)")

        if app_filter:
            params.append(app_filter)
            where += " AND app_slug = ?"

        if status == "error":
            where += " AND response_status_code >= 400"

        if view == "trace":
            where += self._trace_parent_filter()

        total = await self.db.fetchval(
            f"SELECT COUNT(*) FROM api_logs {where}", *params)

        rows = await self.db.fetch(
            f"SELECT {_LOGS_COLUMNS} FROM api_logs {where} "
            f"ORDER BY created_at DESC LIMIT ? OFFSET ?",
            *params, limit, offset)
        for r in rows:
            r["created_at"] = self.db.iso(r["created_at"])
        return total, rows

    async def get_log_raw(self, log_id: int) -> Optional[dict]:
        row = await self.db.fetchrow("SELECT * FROM api_logs WHERE id = ?", log_id)
        if row:
            row["created_at"] = self.db.iso(row.get("created_at"))
        return row

    async def get_log_full(self, log_id: int) -> Optional[dict]:
        return await self.db.fetchrow("SELECT * FROM api_logs WHERE id = ?", log_id)

    async def delete_log(self, log_id: int) -> int:
        return await self.db.execute("DELETE FROM api_logs WHERE id = ?", log_id)

    async def bulk_delete(self, ids: Optional[list[int]] = None,
                         before_date: Optional[str] = None) -> int:
        if ids:
            placeholders = ", ".join(["?"] * len(ids))
            return await self.db.execute(
                f"DELETE FROM api_logs WHERE id IN ({placeholders})", *ids)
        if before_date:
            return await self.db.execute(
                "DELETE FROM api_logs WHERE created_at < ?", before_date)
        return 0

    # ======================================================================
    # TRACE STITCHING (correlated lookups; the walk lives in the route)
    # ======================================================================

    async def find_parent_by_toolcall(self, before_id: int, tc_id: str) -> Optional[dict]:
        cast = "::text" if self.backend == "postgres" else ""
        return await self.db.fetchrow(
            f"SELECT * FROM api_logs WHERE id < ? AND tool_calls{cast} LIKE ? "
            f"ORDER BY id DESC LIMIT 1", before_id, f"%{tc_id}%")

    async def find_child_by_request(self, after_id: int, tc_id: str) -> Optional[dict]:
        cast = "::text" if self.backend == "postgres" else ""
        return await self.db.fetchrow(
            f"SELECT * FROM api_logs WHERE id > ? AND request_body_json{cast} LIKE ? "
            f"ORDER BY id ASC LIMIT 1", after_id, f"%{tc_id}%")

    # ======================================================================
    # SETTINGS
    # ======================================================================

    async def get_settings(self) -> list[dict]:
        rows = await self.db.fetch(
            "SELECT key, value, updated_at FROM settings ORDER BY key")
        for r in rows:
            r["updated_at"] = self.db.iso(r["updated_at"])
        return rows

    async def update_settings(self, settings: dict) -> int:
        for key, value in settings.items():
            await self.db.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = ?",
                key, str(value), self.db.ts_param(), str(value), self.db.ts_param())
        return len(settings)

    # ======================================================================
    # APPS
    # ======================================================================

    async def list_apps(self) -> list[dict]:
        rows = await self.db.fetch(
            "SELECT id, slug, name, target_url, is_default, created_at FROM apps "
            "ORDER BY is_default DESC, name ASC")
        for r in rows:
            r["is_default"] = bool(r["is_default"])
            r["created_at"] = self.db.iso(r["created_at"])
        return rows

    async def get_app(self, app_id: int) -> Optional[dict]:
        row = await self.db.fetchrow("SELECT * FROM apps WHERE id = ?", app_id)
        if row:
            row["is_default"] = bool(row["is_default"])
            row["created_at"] = self.db.iso(row.get("created_at"))
        return row

    async def _unset_defaults(self) -> None:
        await self.db.execute("UPDATE apps SET is_default = FALSE")

    async def create_app(self, slug: str, name: str, target_url: str,
                        is_default: bool) -> dict:
        if is_default:
            await self._unset_defaults()
        try:
            row = await self.db.fetchrow(
                "INSERT INTO apps (slug, name, target_url, is_default, created_at) "
                "VALUES (?, ?, ?, ?, ?) "
                "RETURNING id, slug, name, target_url, is_default, created_at",
                slug, name, target_url, is_default, self.db.ts_param())
        except Exception as e:  # noqa: BLE001 - normalise unique-violation
            if self._is_unique_violation(e):
                raise DuplicateSlug(slug) from e
            raise
        row["is_default"] = bool(row["is_default"])
        row["created_at"] = self.db.iso(row.get("created_at"))
        return row

    async def update_app(self, app_id: int, updates: dict) -> Optional[dict]:
        if not await self.db.fetchrow("SELECT id FROM apps WHERE id = ?", app_id):
            return None
        if updates.get("is_default"):
            await self._unset_defaults()
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            params = list(updates.values()) + [app_id]
            try:
                await self.db.execute(
                    f"UPDATE apps SET {set_clause} WHERE id = ?", *params)
            except Exception as e:  # noqa: BLE001
                if self._is_unique_violation(e):
                    raise DuplicateSlug(updates.get("slug", "")) from e
                raise
        return await self.get_app(app_id)

    async def delete_app(self, app_id: int) -> bool:
        existing = await self.get_app(app_id)
        if not existing:
            return False
        await self.db.execute("DELETE FROM apps WHERE id = ?", app_id)
        if existing["is_default"]:
            first = await self.db.fetchrow(
                "SELECT id FROM apps ORDER BY id ASC LIMIT 1")
            if first:
                await self.db.execute(
                    "UPDATE apps SET is_default = TRUE WHERE id = ?", first["id"])
        return True

    @staticmethod
    def _is_unique_violation(exc: Exception) -> bool:
        name = type(exc).__name__
        if name == "UniqueViolationError":  # asyncpg
            return True
        if name == "IntegrityError":  # sqlite3 / aiosqlite
            return "unique" in str(exc).lower()
        return False

    # ======================================================================
    # EXPORT
    # ======================================================================

    async def get_export_rows(self, start_date: Optional[str],
                             end_date: Optional[str]) -> list[dict]:
        query = ("SELECT request_body_json, final_text FROM api_logs "
                 "WHERE response_status_code = 200 AND final_text != ''")
        params: list = []
        if start_date:
            params.append(start_date)
            query += " AND created_at >= ?"
        if end_date:
            params.append(end_date)
            query += " AND created_at <= ?"
        return await self.db.fetch(query, *params)
