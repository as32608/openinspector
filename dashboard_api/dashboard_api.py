import os
import asyncio
import json
import time
import loguru
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from contextlib import asynccontextmanager
from typing import Optional

from shared.oidb import make_adapter, Repository, DuplicateSlug

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

MAX_WAIT_SECONDS = 120
RETRY_INTERVAL = 3  # seconds
repo: Optional[Repository] = None


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
    global repo

    repo = Repository(make_adapter())
    start_time = time.monotonic()

    while True:
        try:
            await repo.connect()
            loguru.logger.info(f"✅ Connected to database (backend={repo.backend})")
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

    # Schema migrations (idempotent; shared with the proxy).
    await repo.ensure_schema()
    loguru.logger.info("✅ Schema migrations complete")

    yield

    await repo.close()
    loguru.logger.info("🔌 Database connection closed")


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
    return await repo.get_metrics(app_filter)


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
    total, rows = await repo.get_logs(
        limit=limit, offset=offset, search=search, view=view,
        app_filter=app_filter, status=status)

    result = []
    for log in rows:
        log['request_body'] = json.loads(log.get('request_body_json') or '{}')
        log['parsed_tools'] = json.loads(log.get('tool_calls') or '[]')
        log.pop('request_body_json', None)
        result.append(log)

    return {"total": total, "logs": result}


# ============================================================
# LOG RAW DATA
# ============================================================

@app.get("/api/logs/{log_id}/raw")
async def get_log_raw(log_id: int):
    log = await repo.get_log_raw(log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")

    # Parse JSON fields for readability
    for field in ['query_params', 'request_headers', 'request_body_json',
                  'response_headers', 'response_body_json', 'tool_calls']:
        if log.get(field) and isinstance(log[field], str):
            try:
                log[field] = json.loads(log[field])
            except json.JSONDecodeError:
                pass
    return log


# ============================================================
# LOG DELETE
# ============================================================

@app.delete("/api/logs/{log_id}")
async def delete_log(log_id: int):
    deleted = await repo.delete_log(log_id)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Log not found")
    return {"status": "deleted", "id": log_id}


@app.post("/api/logs/bulk-delete")
async def bulk_delete_logs(req: BulkDeleteRequest):
    if not req.ids and not req.before_date:
        raise HTTPException(status_code=400, detail="Provide 'ids' or 'before_date'")
    count = await repo.bulk_delete(ids=req.ids, before_date=req.before_date)
    return {"status": "deleted", "count": count}


# ============================================================
# TRACES
# ============================================================

@app.get("/api/traces/{log_id}")
async def get_trace(log_id: int):
    """
    Bidirectional Trace: Finds the clicked log, builds backwards to find the
    start of the trace, and builds forwards to find the end.
    """
    initial_log = await repo.get_log_full(log_id)
    if not initial_log:
        raise HTTPException(status_code=404, detail="Log not found")

    def parse_log(d):
        d = dict(d)
        d['parsed_req'] = json.loads(d.get('request_body_json') or '{}')
        d['parsed_tools'] = json.loads(d.get('tool_calls') or '[]')
        d['created_at'] = repo.db.iso(d.get('created_at'))
        return d

    clicked_log = parse_log(initial_log)
    chain = [clicked_log]

    # --- BUILD BACKWARDS (Find Parents for both schemas) ---
    curr = clicked_log
    for _ in range(20):
        messages = curr.get('parsed_req', {}).get('messages', [])
        if not messages:
            break

        last_tc_id = None

        # OpenAI schema
        tool_messages = [m for m in messages if m.get('role') == 'tool']
        if tool_messages:
            last_tc_id = tool_messages[-1].get('tool_call_id')
        else:
            # Anthropic schema
            for m in reversed(messages):
                if m.get('role') == 'user' and isinstance(m.get('content'), list):
                    tool_results = [b for b in m['content'] if b.get('type') == 'tool_result']
                    if tool_results:
                        last_tc_id = tool_results[-1].get('tool_use_id')
                        break

        if not last_tc_id:
            break

        parent_log = await repo.find_parent_by_toolcall(curr['id'], last_tc_id)
        if parent_log:
            curr = parse_log(parent_log)
            chain.insert(0, curr)  # Prepend
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

        child_log = await repo.find_child_by_request(curr['id'], tc_id)
        if child_log:
            curr = parse_log(child_log)
            chain.append(curr)  # Append
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
    return {"settings": await repo.get_settings()}


@app.put("/api/settings")
async def update_settings(req: SettingsUpdate):
    count = await repo.update_settings(req.settings)
    return {"status": "updated", "count": count}


# ============================================================
# APPS
# ============================================================

@app.get("/api/apps")
async def list_apps():
    return {"apps": await repo.list_apps()}


@app.post("/api/apps")
async def create_app(req: AppCreate):
    try:
        return await repo.create_app(req.slug, req.name, req.target_url, req.is_default)
    except DuplicateSlug:
        raise HTTPException(status_code=409, detail=f"App with slug '{req.slug}' already exists")


@app.put("/api/apps/{app_id}")
async def update_app(app_id: int, req: AppUpdate):
    updates = {k: v for k, v in {
        "slug": req.slug,
        "name": req.name,
        "target_url": req.target_url,
        "is_default": req.is_default,
    }.items() if v is not None}

    try:
        updated = await repo.update_app(app_id, updates)
    except DuplicateSlug:
        raise HTTPException(status_code=409, detail=f"App with slug '{req.slug}' already exists")
    if updated is None:
        raise HTTPException(status_code=404, detail="App not found")
    return updated


@app.delete("/api/apps/{app_id}")
async def delete_app(app_id: int):
    deleted = await repo.delete_app(app_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="App not found")
    return {"status": "deleted", "id": app_id}


# ============================================================
# EXPORT
# ============================================================

@app.get("/api/export/finetune")
async def export_finetune_jsonl(start_date: str = None, end_date: str = None):
    logs = await repo.get_export_rows(start_date, end_date)

    jsonl_lines = []
    for log in logs:
        req_body = json.loads(log.get('request_body_json') or '{}')
        messages = req_body.get('messages', [])
        if not messages:
            continue
        messages.append({"role": "assistant", "content": log['final_text']})
        jsonl_lines.append(json.dumps({"messages": messages}))

    return PlainTextResponse('\n'.join(jsonl_lines), media_type="application/jsonl", headers={
        "Content-Disposition": "attachment; filename=finetune_export.jsonl"
    })


if __name__ == "__main__":
    import uvicorn
    # Run on a different port than your proxy (e.g., 8081)
    uvicorn.run(app, host="0.0.0.0", port=8081)
