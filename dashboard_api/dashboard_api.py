import os
import json
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
import asyncpg
from contextlib import asynccontextmanager

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


DATABASE_URL = os.getenv("DATABASE_URL")
db_pool = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool
    db_pool = await asyncpg.create_pool(DATABASE_URL)
    yield
    await db_pool.close()

app = FastAPI(title="Open Inspector API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/metrics")
async def get_metrics():
    async with db_pool.acquire() as conn:
        metrics = await conn.fetchrow('''
            SELECT
                COUNT(*) as total_requests,
                AVG(duration_sec) as avg_latency,
                COUNT(*) FILTER (WHERE response_status_code >= 400) as error_count
            FROM api_logs
        ''')
        daily_stats = await conn.fetch('''
            SELECT
                DATE(created_at) as date,
                COUNT(*) as requests,
                AVG(duration_sec) as latency
            FROM api_logs
            GROUP BY DATE(created_at)
            ORDER BY date ASC
            LIMIT 30
        ''')
        return {
            "summary": dict(metrics),
            "chart_data": [dict(row) for row in daily_stats]
        }

@app.get("/api/logs")
async def get_logs(limit: int = 50, offset: int = 0, search: str = "", view: str = "plain"):
    async with db_pool.acquire() as conn:
        base_where = "WHERE 1=1"
        params = []

        if search:
            params.append(f'%{search}%')
            base_where += f" AND (final_text ILIKE ${len(params)} OR final_reasoning_text ILIKE ${len(params)} OR request_body_json::text ILIKE ${len(params)})"

        if view == "trace":
            # Show the root (first) node of a trace
            base_where += """
                AND NOT (
                    jsonb_typeof(request_body_json->'messages') = 'array'
                    AND jsonb_array_length(request_body_json->'messages') > 0
                    AND request_body_json->'messages'->-1->>'role' = 'tool'
                )
            """

        count_query = f"SELECT COUNT(*) FROM api_logs {base_where}"
        total_count = await conn.fetchval(count_query, *params)

        logs_query = f"""
            SELECT id, method, response_status_code, duration_sec, final_text, created_at, tool_calls, request_body_json, final_reasoning_text
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

        # 1. BUILD BACKWARDS (Find Parents)
        curr = clicked_log
        for _ in range(20): # Safety limit
            messages = curr.get('parsed_req', {}).get('messages', [])
            tool_messages = [m for m in messages if m.get('role') == 'tool']
            if not tool_messages:
                break

            # Find the ID of the tool response we just sent
            last_tc_id = tool_messages[-1].get('tool_call_id')
            if not last_tc_id: break

            # Find the parent request that asked for this tool
            parent_log = await conn.fetchrow('''
                SELECT * FROM api_logs
                WHERE id < $1
                AND tool_calls::text LIKE $2
                ORDER BY id DESC LIMIT 1
            ''', curr['id'], f'%{last_tc_id}%')

            if parent_log:
                curr = parse_log(parent_log)
                chain.insert(0, curr) # Prepend to chain
            else:
                break

        # 2. BUILD FORWARDS (Find Children)
        curr = clicked_log
        for _ in range(20):
            parsed_tools = curr.get('parsed_tools', [])
            if not parsed_tools:
                break

            tc_id = parsed_tools[0].get("id")
            if not tc_id: break

            # Find the child request that contains the tool response
            child_log = await conn.fetchrow('''
                SELECT * FROM api_logs
                WHERE id > $1
                AND request_body_json::text LIKE $2
                ORDER BY id ASC LIMIT 1
            ''', curr['id'], f'%{tc_id}%')

            if child_log:
                curr = parse_log(child_log)
                chain.append(curr) # Append to chain
            else:
                break

        return {
            "clicked_log_id": log_id,
            "clicked_log": clicked_log,
            "chain": chain
        }

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
