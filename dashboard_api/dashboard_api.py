import os
import asyncio
import json
import time
import loguru
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
import asyncpg
from contextlib import asynccontextmanager
from typing import Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

MAX_WAIT_SECONDS = 120
RETRY_INTERVAL = 3  # seconds
DATABASE_URL = os.getenv("DATABASE_URL")
db_pool = None


# --- Pydantic Models ---
class AppCreate(BaseModel):
    slug: str
    name: str
    target_url: str
    is_default: bool = False


class AppUpdate(BaseModel):
    slug: Optional[str] = None
    name: Optional[str] = None
    target_url: Optional[str] = None
    is_default: Optional[bool] = None


class SettingsUpdate(BaseModel):
    settings: dict[str, str]


class BulkDeleteRequest(BaseModel):
    ids: Optional[list[int]] = None
    before_date: Optional[str] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool

    start_time = time.monotonic()

    while True:
        try:
            db_pool = await asyncpg.create_pool(DATABASE_URL)
            loguru.logger.info("✅ Connected to database")
            break
        except Exception as e:
            elapsed = time.monotonic() - start_time

            if elapsed > MAX_WAIT_SECONDS:
                loguru.logger.error(
                    "❌ Could not connect to database after 2 minutes")
                raise e

            loguru.logger.warning(
                f"⏳ DB not ready yet, retrying in {RETRY_INTERVAL}s...")
            await asyncio.sleep(RETRY_INTERVAL)

    # Run schema migrations (idempotent)
    async with db_pool.acquire() as conn:
        # Ensure settings table exists
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        ''')
        # Ensure apps table exists
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS apps (
                id SERIAL PRIMARY KEY,
                slug TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                target_url TEXT NOT NULL,
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        ''')
        # Ensure app_slug column exists on api_logs
        await conn.execute('''
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
        await conn.execute('CREATE INDEX IF NOT EXISTS idx_logs_app_slug ON api_logs (app_slug)')

    loguru.logger.info("✅ Schema migrations complete")

    yield

    await db_pool.close()
    loguru.logger.info("🔌 Database pool closed")


app = FastAPI(title="Open Inspector API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# METRICS
# ============================================================

@app.get("/api/metrics")
async def get_metrics(app_filter: str = Query("", alias="app")):
    async with db_pool.acquire() as conn:
        where = "WHERE 1=1"
        params = []

        if app_filter:
            params.append(app_filter)
            where += f" AND app_slug = ${len(params)}"

        metrics = await conn.fetchrow(f'''
            SELECT
                COUNT(*) as total_requests,
                AVG(duration_sec) as avg_latency,
                COUNT(*) FILTER (WHERE response_status_code >= 400) as error_count
            FROM api_logs {where}
        ''', *params)

        daily_stats = await conn.fetch(f'''
            SELECT
                DATE(created_at) as date,
                COUNT(*) as requests,
                AVG(duration_sec) as latency
            FROM api_logs {where}
            GROUP BY DATE(created_at)
            ORDER BY date ASC
            LIMIT 30
        ''', *params)

        # Per-app breakdown (always returned)
        app_breakdown = await conn.fetch('''
            SELECT
                COALESCE(app_slug, 'default') as app_slug,
                COUNT(*) as total_requests,
                COUNT(*) FILTER (WHERE response_status_code >= 400) as error_count
            FROM api_logs
            GROUP BY app_slug
            ORDER BY total_requests DESC
        ''')

        return {
            "summary": dict(metrics),
            "chart_data": [dict(row) for row in daily_stats],
            "app_breakdown": [dict(row) for row in app_breakdown]
        }


# ============================================================
# LOGS
# ============================================================

@app.get("/api/logs")
async def get_logs(
    limit: int = 50,
    offset: int = 0,
    search: str = "",
    view: str = "plain",
    app_filter: str = Query("", alias="app"),
    status: str = ""
):
    async with db_pool.acquire() as conn:
        base_where = "WHERE 1=1"
        params = []

        if search:
            params.append(f'%{search}%')
            base_where += f" AND (final_text ILIKE ${len(params)} OR final_reasoning_text ILIKE ${len(params)} OR request_body_json::text ILIKE ${len(params)})"

        if app_filter:
            params.append(app_filter)
            base_where += f" AND app_slug = ${len(params)}"

        if status == "error":
            base_where += " AND response_status_code >= 400"

        if view == "trace":
            # --- FIX: Robust Filter for Trace Parents ---
            # Excludes OpenAI follow-ups (role = tool) AND Anthropic
            # follow-ups (role = user + tool_result block)
            base_where += """
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

        count_query = f"SELECT COUNT(*) FROM api_logs {base_where}"
        total_count = await conn.fetchval(count_query, *params)

        logs_query = f"""
            SELECT id, method, response_status_code, duration_sec, final_text, created_at, tool_calls, request_body_json, final_reasoning_text, app_slug
            FROM api_logs {base_where}
            ORDER BY created_at DESC LIMIT ${len(params)+1} OFFSET ${len(params)+2}
        """

        query_params = params + [limit, offset]
        logs = await conn.fetch(logs_query, *query_params)

        result = []
        for log in logs:
            l = dict(log)
            l['request_body'] = json.loads(l['request_body_json'] or '{}')
            l['parsed_tools'] = json.loads(l['tool_calls'] or '[]')
            del l['request_body_json']
            result.append(l)

        return {"total": total_count, "logs": result}


# ============================================================
# LOG RAW DATA
# ============================================================

@app.get("/api/logs/{log_id}/raw")
async def get_log_raw(log_id: int):
    async with db_pool.acquire() as conn:
        log = await conn.fetchrow('SELECT * FROM api_logs WHERE id = $1', log_id)
        if not log:
            raise HTTPException(status_code=404, detail="Log not found")

        d = dict(log)
        # Parse JSON fields for readability
        for field in ['query_params', 'request_headers', 'request_body_json',
                      'response_headers', 'response_body_json', 'tool_calls']:
            if d.get(field) and isinstance(d[field], str):
                try:
                    d[field] = json.loads(d[field])
                except:
                    pass

        # Convert datetime to string
        if d.get('created_at'):
            d['created_at'] = d['created_at'].isoformat()

        return d


# ============================================================
# LOG DELETE
# ============================================================

@app.delete("/api/logs/{log_id}")
async def delete_log(log_id: int):
    async with db_pool.acquire() as conn:
        result = await conn.execute('DELETE FROM api_logs WHERE id = $1', log_id)
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Log not found")
        return {"status": "deleted", "id": log_id}


@app.post("/api/logs/bulk-delete")
async def bulk_delete_logs(req: BulkDeleteRequest):
    async with db_pool.acquire() as conn:
        if req.ids:
            result = await conn.execute(
                'DELETE FROM api_logs WHERE id = ANY($1::int[])', req.ids
            )
            count = int(result.split(" ")[1])
            return {"status": "deleted", "count": count}
        elif req.before_date:
            result = await conn.execute(
                'DELETE FROM api_logs WHERE created_at < $1::timestamp', req.before_date
            )
            count = int(result.split(" ")[1])
            return {"status": "deleted", "count": count}
        else:
            raise HTTPException(status_code=400, detail="Provide 'ids' or 'before_date'")


# ============================================================
# TRACES
# ============================================================

@app.get("/api/traces/{log_id}")
async def get_trace(log_id: int):
    """
    Bidirectional Trace: Finds the clicked log, builds backwards to find the
    start of the trace, and builds forwards to find the end.
    """
    async with db_pool.acquire() as conn:
        initial_log = await conn.fetchrow('SELECT * FROM api_logs WHERE id = $1', log_id)
        if not initial_log:
            raise HTTPException(status_code=404, detail="Log not found")

        def parse_log(l):
            d = dict(l)
            d['parsed_req'] = json.loads(d.get('request_body_json') or '{}')
            d['parsed_tools'] = json.loads(d.get('tool_calls') or '[]')
            return d

        clicked_log = parse_log(initial_log)
        chain = [clicked_log]

        # --- FIX: BUILD BACKWARDS (Find Parents for both Schemas) ---
        curr = clicked_log
        for _ in range(20):
            messages = curr.get('parsed_req', {}).get('messages', [])
            if not messages:
                break

            last_tc_id = None

            # Check OpenAI schema
            tool_messages = [m for m in messages if m.get('role') == 'tool']
            if tool_messages:
                last_tc_id = tool_messages[-1].get('tool_call_id')
            else:
                # Check Anthropic schema
                for m in reversed(messages):
                    if m.get('role') == 'user' and isinstance(m.get('content'), list):
                        tool_results = [b for b in m['content'] if b.get('type') == 'tool_result']
                        if tool_results:
                            last_tc_id = tool_results[-1].get('tool_use_id')
                            break

            if not last_tc_id:
                break

            parent_log = await conn.fetchrow('''
                SELECT * FROM api_logs
                WHERE id < $1
                AND tool_calls::text LIKE $2
                ORDER BY id DESC LIMIT 1
            ''', curr['id'], f'%{last_tc_id}%')

            if parent_log:
                curr = parse_log(parent_log)
                chain.insert(0, curr)  # Prepend to chain
            else:
                break

        # BUILD FORWARDS (Find Children)
        curr = clicked_log
        for _ in range(20):
            parsed_tools = curr.get('parsed_tools', [])
            if not parsed_tools:
                break

            tc_id = parsed_tools[0].get("id")
            if not tc_id:
                break

            child_log = await conn.fetchrow('''
                SELECT * FROM api_logs
                WHERE id > $1
                AND request_body_json::text LIKE $2
                ORDER BY id ASC LIMIT 1
            ''', curr['id'], f'%{tc_id}%')

            if child_log:
                curr = parse_log(child_log)
                chain.append(curr)  # Append to chain
            else:
                break

        return {
            "clicked_log_id": log_id,
            "clicked_log": clicked_log,
            "chain": chain
        }


# ============================================================
# SETTINGS
# ============================================================

@app.get("/api/settings")
async def get_settings():
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT key, value, updated_at FROM settings ORDER BY key")
        return {"settings": [dict(r) for r in rows]}


@app.put("/api/settings")
async def update_settings(req: SettingsUpdate):
    async with db_pool.acquire() as conn:
        for key, value in req.settings.items():
            await conn.execute('''
                INSERT INTO settings (key, value, updated_at)
                VALUES ($1, $2, NOW())
                ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
            ''', key, str(value))
    return {"status": "updated", "count": len(req.settings)}


# ============================================================
# APPS
# ============================================================

@app.get("/api/apps")
async def list_apps():
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, slug, name, target_url, is_default, created_at FROM apps ORDER BY is_default DESC, name ASC"
        )
        result = []
        for r in rows:
            d = dict(r)
            if d.get('created_at'):
                d['created_at'] = d['created_at'].isoformat()
            result.append(d)
        return {"apps": result}


@app.post("/api/apps")
async def create_app(req: AppCreate):
    async with db_pool.acquire() as conn:
        # If this is set as default, unset other defaults
        if req.is_default:
            await conn.execute("UPDATE apps SET is_default = FALSE")

        try:
            row = await conn.fetchrow('''
                INSERT INTO apps (slug, name, target_url, is_default)
                VALUES ($1, $2, $3, $4)
                RETURNING id, slug, name, target_url, is_default, created_at
            ''', req.slug, req.name, req.target_url, req.is_default)
        except asyncpg.UniqueViolationError:
            raise HTTPException(status_code=409, detail=f"App with slug '{req.slug}' already exists")

        d = dict(row)
        if d.get('created_at'):
            d['created_at'] = d['created_at'].isoformat()
        return d


@app.put("/api/apps/{app_id}")
async def update_app(app_id: int, req: AppUpdate):
    async with db_pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT * FROM apps WHERE id = $1", app_id)
        if not existing:
            raise HTTPException(status_code=404, detail="App not found")

        # If setting as default, unset others first
        if req.is_default:
            await conn.execute("UPDATE apps SET is_default = FALSE")

        updates = {}
        if req.slug is not None:
            updates["slug"] = req.slug
        if req.name is not None:
            updates["name"] = req.name
        if req.target_url is not None:
            updates["target_url"] = req.target_url
        if req.is_default is not None:
            updates["is_default"] = req.is_default

        if updates:
            set_clauses = []
            params = []
            for i, (k, v) in enumerate(updates.items(), 1):
                set_clauses.append(f"{k} = ${i}")
                params.append(v)
            params.append(app_id)
            query = f"UPDATE apps SET {', '.join(set_clauses)} WHERE id = ${len(params)}"
            await conn.execute(query, *params)

        row = await conn.fetchrow(
            "SELECT id, slug, name, target_url, is_default, created_at FROM apps WHERE id = $1",
            app_id
        )
        d = dict(row)
        if d.get('created_at'):
            d['created_at'] = d['created_at'].isoformat()
        return d


@app.delete("/api/apps/{app_id}")
async def delete_app(app_id: int):
    async with db_pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT * FROM apps WHERE id = $1", app_id)
        if not existing:
            raise HTTPException(status_code=404, detail="App not found")

        await conn.execute("DELETE FROM apps WHERE id = $1", app_id)

        # If we deleted the default, make the first remaining app default
        if existing['is_default']:
            first = await conn.fetchrow("SELECT id FROM apps ORDER BY id ASC LIMIT 1")
            if first:
                await conn.execute("UPDATE apps SET is_default = TRUE WHERE id = $1", first['id'])

        return {"status": "deleted", "id": app_id}


# ============================================================
# EXPORT
# ============================================================

@app.get("/api/export/finetune")
async def export_finetune_jsonl(start_date: str = None, end_date: str = None):
    async with db_pool.acquire() as conn:
        query = '''
            SELECT request_body_json, final_text
            FROM api_logs
            WHERE response_status_code = 200 AND final_text != ''
        '''
        params = []
        if start_date:
            params.append(start_date)
            query += f" AND created_at >= ${len(params)}::timestamp"
        if end_date:
            params.append(end_date)
            query += f" AND created_at <= ${len(params)}::timestamp"

        logs = await conn.fetch(query, *params)

        jsonl_lines = []
        for log in logs:
            req_body = json.loads(log['request_body_json'] or '{}')
            messages = req_body.get('messages', [])
            if not messages: continue
            messages.append({"role": "assistant", "content": log['final_text']})
            jsonl_lines.append(json.dumps({"messages": messages}))

        return PlainTextResponse('\n'.join(jsonl_lines), media_type="application/jsonl", headers={
            "Content-Disposition": "attachment; filename=finetune_export.jsonl"
        })


if __name__ == "__main__":
    import uvicorn
    # Run on a different port than your proxy (e.g., 8081)
    uvicorn.run(app, host="0.0.0.0", port=8081)
