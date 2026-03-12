import os
import re
import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
import uvicorn
import json
import time
import loguru
import asyncpg
import asyncio
import random
from contextlib import asynccontextmanager

logger = loguru.logger
pat_text_stream = re.compile(r'^data: (\{.*\})$')

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

BASE_URL = os.getenv("BASE_URL")
PROXY_HOST = os.getenv("PROXY_HOST", "0.0.0.0")
PROXY_PORT = int(os.getenv("PROXY_PORT", 8080))
DATABASE_URL = os.getenv("DATABASE_URL")
GLOBAL_TIMEOUT = int(os.getenv("GLOBAL_TIMEOUT", 150))  # To Kill long request
MAX_RETRIES = int(os.getenv('MAX_RETRIES', 3))
BASE_DELAY = float(os.getenv('BASE_DELAY', 3.0))


db_pool = None
client = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool, client

    # Initialize the HTTPX client here so all workers get it
    client = httpx.AsyncClient(base_url=BASE_URL, timeout=None)
    logger.info(f"Initialized httpx client pointing to {BASE_URL}")
    # Database Initialization
    if DATABASE_URL:
        try:
            db_pool = await asyncpg.create_pool(DATABASE_URL)
            async with db_pool.acquire() as conn:
                await conn.execute('''
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
            logger.info("Database and Schema ready.")
        except Exception as e:
            logger.error(f"DB Connection Error: {e}")
    else:
        logger.warning(
            "DATABASE_URL is not set. Logging to DB will be skipped.")
    yield  # App runs here
    # Cleanup on shutdown
    if db_pool:
        await db_pool.close()
    if client:
        await client.aclose()  # Clean up the HTTP client

app = FastAPI(title="Ollama/OpenRouter Proxy", lifespan=lifespan)


def normalize_tool_calls(raw_calls):
    """
    Standardizes tool calls from various formats (OpenAI Sync/Async, Langchain)
    into a consistent flat list of {id, name, arguments}.
    """
    normalized = []
    if not raw_calls or not isinstance(raw_calls, list):
        return normalized

    for tc in raw_calls:
        # Standardize ID
        tc_id = tc.get("id")

        # Extract Name and Arguments (Handle nested 'function' object vs flat)
        if "function" in tc:
            name = tc["function"].get("name")
            args = tc["function"].get("arguments")
        else:
            name = tc.get("name")
            args = tc.get("arguments")

        # Ensure arguments is a parsed JSON object for the DB
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                pass

        normalized.append({
            "id": tc_id,
            "name": name,
            "arguments": args
        })
    return normalized


async def process_log(log: dict):
    already_logged = log.get('logged', False)
    if log.get("response") and log.get("request") and db_pool and (
            not already_logged):
        logger.info(
            "Complete Input/Output captured. Processing for DB insertion...")

        req = log["request"]
        res = log["response"]
        resp_data = res.get("response", {})

        # 1. Extract Text and Reasoning
        final_text = resp_data.get("final_text", "")
        final_reasoning = resp_data.get("final_reasoning_text", "")

        # Standardize Tool Calls before DB insertion
        raw_tool_calls = resp_data.get("tool_calls", [])
        if not raw_tool_calls and "choices" in resp_data and len(
                resp_data["choices"]) > 0:
            msg = resp_data["choices"][0].get("message", {})
            raw_tool_calls = msg.get("tool_calls") or []
            final_text = msg.get("content") or final_text
            final_reasoning = msg.get("reasoning") or final_reasoning

        tool_calls = normalize_tool_calls(raw_tool_calls)

        try:
            async with db_pool.acquire() as conn:
                await conn.execute(
                    '''
                    INSERT INTO api_logs (
                        url,
                        method,
                        query_params,
                        request_headers,
                        request_content_type,
                        request_body_raw,
                        request_body_json,
                        response_status_code,
                        response_headers,
                        response_content_type,
                        response_body_raw,
                        response_body_json,
                        final_text,
                        final_reasoning_text,
                        tool_calls,
                        duration_sec
                    ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12::jsonb, $13, $14, $15::jsonb, $16)
                    ''',
                    str(req.get("url")),
                    req.get("method"),
                    json.dumps(req.get("query_params")),
                    json.dumps(req.get("headers")),
                    req.get("headers", {}).get("content-type"),
                    req.get("raw_body"),
                    json.dumps(req.get("body")),
                    res.get("status_code"),
                    json.dumps(res.get("headers")),
                    res.get("content_type"),
                    res.get("raw_response"),
                    json.dumps(resp_data),
                    final_text,
                    final_reasoning,
                    json.dumps(tool_calls),
                    res.get("duration_sec")
                )
            log['logged'] = True
        except Exception as e:
            logger.error(f"Postgres Insert Failed: {e}")


async def log_request_details(request: Request, body: bytes, store: dict):
    raw_body = body.decode('utf-8', errors='replace')
    store["request"] = {
        "url": str(request.url),
        "method": request.method,
        "headers": dict(request.headers),
        "query_params": dict(request.query_params),
        "raw_body": raw_body,
        "body": json.loads(raw_body) if "json" in request.headers.get(
            "content-type", "") else None
    }
    await process_log(store)


async def stream_ollama_response(
        response: httpx.Response, start_time: float, store: dict):
    full_body = bytearray()
    content_type = response.headers.get("content-type", "").lower()

    try:
        # Wrap the stream consumption in a timeout
        async for chunk in response.aiter_bytes():
            if time.time() - start_time > GLOBAL_TIMEOUT:
                logger.error(f"Streaming exceeded {GLOBAL_TIMEOUT}s timeout.")
                break
            full_body.extend(chunk)
            yield chunk

        duration = time.time() - start_time
        decoded = full_body.decode('utf-8', errors='replace')

        content_acc = []
        reasoning_acc = []
        tool_call_map = {}  # index -> {id, name, args}

        # Determine if we are dealing with Ollama NDJSON or standard SSE
        is_ndjson = "application/x-ndjson" in content_type

        for line in decoded.split('\n'):
            line = line.strip()
            if not line or line.startswith(':') or line == 'data: [DONE]':
                continue

            # Remove "data: " prefix for SSE, or use raw line for NDJSON
            json_str = line
            if not is_ndjson:
                match = pat_text_stream.match(line)
                if not match:
                    continue
                json_str = match.group(1)

            try:
                data = json.loads(json_str)

                # --- Handle Ollama Native Format ---
                if is_ndjson:
                    msg = data.get("message", {})
                    if msg.get("content"):
                        content_acc.append(msg["content"])

                    # Ollama doesn't have a standard 'reasoning' field yet,
                    # but we check common experimental ones
                    if msg.get("reasoning"):
                        reasoning_acc.append(msg["reasoning"])

                    t_calls = msg.get("tool_calls", [])
                    for i, tc in enumerate(t_calls):
                        # Ollama doesn't always provide an index in the chunk,
                        # so we use ID or list position
                        idx = tc.get("id") or i
                        if idx not in tool_call_map:
                            tool_call_map[idx] = {
                                "id": tc.get("id"), "name": "", "arguments": ""
                            }

                        f = tc.get("function", {})
                        if f.get("name"):
                            tool_call_map[idx]["name"] = f["name"]

                        # Ollama sends arguments as DICT, OpenRouter
                        # sends as STRING
                        args = f.get("arguments")
                        if isinstance(args, dict):
                            # Convert to string temporarily to maintain the
                            # aggregator logic
                            tool_call_map[idx]["arguments"] += json.dumps(args)
                        elif isinstance(args, str):
                            tool_call_map[idx]["arguments"] += args

                # --- Handle OpenAI / OpenRouter Format ---
                else:
                    choices = data.get("choices", [])
                    if not choices:
                        continue
                    delta = choices[0].get("delta", {})

                    if delta.get("content"):
                        content_acc.append(delta["content"])

                    reasoning = delta.get("reasoning") or delta.get("thinking")
                    if reasoning:
                        reasoning_acc.append(reasoning)

                    t_calls = delta.get("tool_calls", [])
                    for tc in t_calls:
                        idx = tc.get("index")
                        if idx not in tool_call_map:
                            tool_call_map[idx] = {
                                "id": None, "name": "", "arguments": ""}
                        if tc.get("id"):
                            tool_call_map[idx]["id"] = tc["id"]
                        if "function" in tc:
                            f = tc["function"]
                            if f.get("name"):
                                tool_call_map[idx]["name"] = f["name"]
                            if f.get("arguments"):
                                tool_call_map[idx]["arguments"] += f[
                                    "arguments"]
            except Exception as e:
                logger.debug(f"Chunk parse error: {e}")
                continue

        # Final cleanup: Ensure arguments are stored as objects, not
        # concatenated JSON strings
        final_tools = list(tool_call_map.values())
        for tool in final_tools:
            if isinstance(tool["arguments"], str) and tool[
                    "arguments"].startswith('{'):
                try:
                    # In Ollama cases where it was a dict converted to string,
                    # we just need the first valid JSON object
                    tool["arguments"] = json.loads(tool["arguments"])
                except:
                    pass

        store["response"] = {
            "status_code": response.status_code,
            "content_type": content_type,
            "headers": dict(response.headers),
            "duration_sec": round(duration, 3),
            "raw_response": decoded,
            "response": {
                "final_text": "".join(content_acc),
                "final_reasoning_text": "".join(reasoning_acc),
                "tool_calls": normalize_tool_calls(final_tools)
            }
        }
        await process_log(store)
    finally:
        await response.aclose()


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy(request: Request, path: str):
    start_time = time.time()
    body = await request.body()
    req_store = {}

    # Header Preparation (Fixing DecodingError)
    fwd_headers = {k: v for k, v in request.headers.items()
                   if k.lower() not in [
                       'host', 'content-length', 'accept-encoding']}
    fwd_headers['accept-encoding'] = 'identity'
    fwd_headers['connection'] = 'close'

    try:
        # 1. Retry and Timeout Logic for the Initial Connection
        response = None
        for attempt in range(MAX_RETRIES):
            try:
                req = client.build_request(
                    request.method,
                    request.url.path,
                    headers=fwd_headers,
                    content=body,
                    params=request.query_params
                )
                # Ensure the network request doesn't hang forever
                response = await asyncio.wait_for(
                    client.send(req, stream=True), timeout=GLOBAL_TIMEOUT)

                if response.status_code == 429:
                    logger.warning(f"Rate Limited (429). Attempt {attempt+1}")
                    await response.aclose()
                    await asyncio.sleep(
                        BASE_DELAY * (2 ** attempt) + random.uniform(0, 1))
                    continue
                break
            except asyncio.TimeoutError:
                logger.error(
                    "Request timed out during connection "
                    f"(Attempt {attempt+1})")
                if attempt == MAX_RETRIES - 1:
                    raise
            except Exception as e:
                if attempt == MAX_RETRIES - 1:
                    raise e
                await asyncio.sleep(1)

        # 2. Handle Response
        is_stream = "json" not in response.headers.get("content-type", "") or \
                    (json.loads(body).get("stream") if body else False)

        if is_stream:
            return StreamingResponse(
                stream_ollama_response(response, start_time, req_store),
                status_code=response.status_code,
                media_type=response.headers.get("content-type"),
                background=BackgroundTask(
                    log_request_details, request, body, req_store)
            )
        else:
            # Wrap standard reading in a timeout
            await asyncio.wait_for(response.aread(), timeout=GLOBAL_TIMEOUT)
            duration = time.time() - start_time
            decoded_res = response.content.decode('utf-8', errors='replace')
            req_store["response"] = {
                "status_code": response.status_code,
                "content_type": response.headers.get("content-type"),
                "headers": dict(response.headers),
                "duration_sec": round(duration, 3),
                "raw_response": decoded_res,
                "response": json.loads(
                    decoded_res) if "json" in response.headers.get(
                        "content-type", "") else {}
            }
            await log_request_details(request, body, req_store)
            await process_log(req_store)
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers=dict(response.headers))

    except asyncio.TimeoutError:
        return Response(
            content=f"Request exceeded {GLOBAL_TIMEOUT} sec timeout",
            status_code=504)
    except Exception as e:
        logger.exception("Proxy Error")
        return Response(
            content=f"Internal Proxy Error: {str(e)}", status_code=502)

if __name__ == "__main__":
    logger.info(f'BASE_URL : {BASE_URL}')
    logger.info(f'PROXY_HOST      : {PROXY_HOST}')
    logger.info(f'PROXY_PORT      : {PROXY_PORT}')
    logger.info(f'DATABASE_URL    : {DATABASE_URL}')
    logger.info(f'GLOBAL_TIMEOUT  : {GLOBAL_TIMEOUT}')
    logger.info(f'MAX_RETRIES     : {MAX_RETRIES}')
    logger.info(f'BASE_DELAY      : {BASE_DELAY}')
    uvicorn.run("main:app", host=PROXY_HOST, port=PROXY_PORT, reload=False)
