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
import asyncio
import random
from contextlib import asynccontextmanager

from shared.oidb import make_adapter, Repository

logger = loguru.logger
pat_text_stream = re.compile(r'^data: (\{.*\})$')

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# --- Bootstrap values from .env (used only for initial DB seeding) ---
_ENV_BASE_URL = os.getenv("BASE_URL", "")
_ENV_GLOBAL_TIMEOUT = os.getenv("GLOBAL_TIMEOUT", "150").strip()
_ENV_MAX_RETRIES = os.getenv("MAX_RETRIES", "3").strip()
_ENV_BASE_DELAY = os.getenv("BASE_DELAY", "3.0").strip()
_ENV_READ_TIMEOUT = os.getenv("READ_TIMEOUT", "60").strip()

PROXY_HOST = os.getenv("PROXY_HOST", "0.0.0.0")
PROXY_PORT = int(os.getenv("PROXY_PORT", 8080))
DATABASE_URL = os.getenv("DATABASE_URL")

# A DB is used when either a DATABASE_URL or an explicit DB_BACKEND is set
# (the latter covers sqlite, which needs no URL). Otherwise the proxy runs in
# env-only mode with no logging.
_DB_CONFIGURED = bool(DATABASE_URL or os.getenv("DB_BACKEND"))

# Database connection retry (matches dashboard_api behaviour). On a host reboot
# the proxy can start before Postgres is ready; we retry with backoff and let
# the process die on deadline so `restart: always` reschedules it, rather than
# silently serving traffic with empty config caches.
MAX_WAIT_SECONDS = 120
RETRY_INTERVAL = 3  # seconds

# --- In-memory dynamic config (refreshed from DB) ---
_settings_cache: dict[str, str] = {}
_apps_cache: list[dict] = []
_cache_lock = asyncio.Lock()
_client_pool: dict[str, httpx.AsyncClient] = {}

# Flips to True only once settings/apps have been loaded into the caches above
# (either from the DB or, when DATABASE_URL is unset, from env). Until then the
# proxy has no routing config and must not forward.
_config_loaded = False

# Data-access layer (pluggable Postgres/SQLite backend, see shared/oidb).
repo: Repository | None = None


def get_setting(key: str, default: str = "") -> str:
    return _settings_cache.get(key, default)


def get_setting_int(key: str, default: int = 0) -> int:
    try:
        return int(get_setting(key, str(default)))
    except (ValueError, TypeError):
        return default


def get_setting_float(key: str, default: float = 0.0) -> float:
    try:
        return float(get_setting(key, str(default)))
    except (ValueError, TypeError):
        return default


async def _refresh_config():
    """Periodically refresh settings and apps from the database."""
    global _settings_cache, _apps_cache
    while True:
        try:
            if repo:
                new_settings = await repo.fetch_settings_map()
                app_rows = await repo.fetch_apps()
                new_apps = app_rows if app_rows else _apps_cache

                async with _cache_lock:
                    _settings_cache = new_settings
                    _apps_cache = new_apps

                # Clean up clients for removed origins
                active_origins = set()
                for a in new_apps:
                    active_origins.add(a["target_url"].rstrip("/"))
                base_url = new_settings.get("BASE_URL", "")
                if base_url:
                    active_origins.add(base_url.rstrip("/"))

                stale = [k for k in _client_pool if k not in active_origins]
                for k in stale:
                    c = _client_pool.pop(k)
                    await c.aclose()

        except Exception as e:
            logger.debug(f"Config refresh error: {e}")

        await asyncio.sleep(5)


def _get_client(base_url: str) -> httpx.AsyncClient:
    """Get or create an httpx.AsyncClient for the given base_url."""
    key = base_url.rstrip("/")
    if key not in _client_pool:
        # Bound per-operation timeouts so a stalled upstream (e.g. a model that
        # stops emitting chunks mid-stream) is detected promptly. pool=None
        # leaves connection-pool acquisition unbounded. The cumulative
        # GLOBAL_TIMEOUT still caps total stream duration separately.
        read_timeout = get_setting_float("READ_TIMEOUT", 60.0)
        timeout = httpx.Timeout(
            connect=10.0, read=read_timeout, write=10.0, pool=None)
        _client_pool[key] = httpx.AsyncClient(base_url=key, timeout=timeout)
        logger.info(
            f"Created new httpx client for: {key} (read_timeout={read_timeout}s)")
    return _client_pool[key]


def _resolve_app(path: str) -> tuple[str, str, str]:
    """
    Given a request path, resolve the app slug and target URL.
    Returns (app_slug, target_base_url, remaining_path).
    """
    # Check for /app-{slug}/... pattern
    match = re.match(r'^app-([^/]+)(?:/(.*))?$', path)
    if match:
        slug = match.group(1)
        remaining = match.group(2) or ""

        for app in _apps_cache:
            if app["slug"] == slug:
                return slug, app["target_url"].rstrip("/"), remaining

        # Slug not found — treat as unknown, use default
        logger.warning(f"Unknown app slug '{slug}', falling back to default")
        logger.debug(f"Available apps: {[a['slug'] for a in _apps_cache]}")


    # No app- prefix or unknown slug: use default app or BASE_URL setting
    for app in _apps_cache:
        if app.get("is_default"):
            return app["slug"], app["target_url"].rstrip("/"), path

    # Final fallback: BASE_URL from settings
    fallback = get_setting("BASE_URL", _ENV_BASE_URL)
    return "default", fallback.rstrip("/") if fallback else "", path


@asynccontextmanager
async def lifespan(app: FastAPI):
    global repo, _config_loaded

    # Database Initialization
    if _DB_CONFIGURED:
        repo = Repository(make_adapter())

        # 1. Connect with retry/backoff. Raise on deadline so the container
        #    restarts instead of running with no DB.
        start_time = time.monotonic()
        while True:
            try:
                await repo.connect()
                logger.info(f"Connected to database (backend={repo.backend})")
                break
            except Exception:
                if time.monotonic() - start_time > MAX_WAIT_SECONDS:
                    logger.error(
                        "Could not connect to database within "
                        f"{MAX_WAIT_SECONDS}s; exiting so the container restarts.")
                    raise
                logger.warning(
                    f"DB not ready yet, retrying in {RETRY_INTERVAL}s...")
                await asyncio.sleep(RETRY_INTERVAL)

        # 2. Schema + seed. Let errors propagate (fail loud) — a half-initialised
        #    schema must not be papered over.
        try:
            await repo.ensure_schema()
            await repo.seed_initial(
                settings_seeds={
                    "BASE_URL": _ENV_BASE_URL,
                    "GLOBAL_TIMEOUT": _ENV_GLOBAL_TIMEOUT,
                    "MAX_RETRIES": _ENV_MAX_RETRIES,
                    "BASE_DELAY": _ENV_BASE_DELAY,
                    "READ_TIMEOUT": _ENV_READ_TIMEOUT,
                },
                default_app=({
                    "slug": "default", "name": "Default",
                    "target_url": _ENV_BASE_URL,
                } if _ENV_BASE_URL else None),
            )
        except Exception:
            logger.exception("Schema initialization failed; exiting.")
            raise

        logger.info("Database and Schema ready.")

        # 3. Load initial config into cache before serving any traffic.
        _settings_cache.update(await repo.fetch_settings_map())
        _apps_cache.clear()
        _apps_cache.extend(await repo.fetch_apps())

        _config_loaded = True
        logger.info(f"Loaded {len(_settings_cache)} settings and {len(_apps_cache)} apps from DB.")

        # 4. Start background config refresh (kept on app state so it isn't GC'd)
        app.state.refresh_task = asyncio.create_task(_refresh_config())

    else:
        logger.warning("DATABASE_URL is not set. Logging to DB will be skipped.")
        # Fall back to env vars for settings
        _settings_cache["BASE_URL"] = _ENV_BASE_URL
        _settings_cache["GLOBAL_TIMEOUT"] = _ENV_GLOBAL_TIMEOUT
        _settings_cache["MAX_RETRIES"] = _ENV_MAX_RETRIES
        _settings_cache["BASE_DELAY"] = _ENV_BASE_DELAY
        _settings_cache["READ_TIMEOUT"] = _ENV_READ_TIMEOUT
        _config_loaded = True

    yield  # App runs here

    # Cleanup on shutdown
    if repo:
        await repo.close()
    for c in _client_pool.values():
        await c.aclose()
    _client_pool.clear()

app = FastAPI(title="OpenInspector Proxy", lifespan=lifespan)


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
    if not (log.get("response") and log.get("request") and repo and (
            not already_logged)):
        return

    req = log["request"]
    res = log["response"]
    resp_data = res.get("response", {})
    app_slug = log.get("app_slug", "default")

    # Provider-Agnostic Content Extraction
    final_text = resp_data.get("final_text", "")
    final_reasoning = resp_data.get("final_reasoning_text", "")

    # Standardize Tool Calls before DB insertion
    raw_tools = resp_data.get("tool_calls", [])

    # Handle Non-Streaming OpenAI/Anthropic structures
    if not final_text and "choices" in resp_data:  # OpenAI
        msg = resp_data["choices"][0].get("message", {})
        final_text = msg.get("content") or ""
        final_reasoning = msg.get("reasoning") or ""
        raw_tools = msg.get("tool_calls") or []
    elif not final_text and "content" in resp_data and isinstance(
            resp_data["content"], list):  # Anthropic Non-Stream
        for block in resp_data["content"]:
            if block.get("type") == "text":
                final_text += block.get("text", "")
            if block.get("type") == "thinking":
                final_reasoning += block.get("thinking", "")
            if block.get("type") == "tool_use":
                raw_tools.append(block)

    try:
        await repo.insert_log(
            url=str(req.get("url")),
            method=req.get("method"),
            query_params=req.get("query_params"),
            request_headers=req.get("headers"),
            request_content_type=req.get("headers", {}).get("content-type"),
            request_body_raw=req.get("raw_body"),
            request_body=req.get("body"),
            status_code=res.get("status_code"),
            response_headers=res.get("headers"),
            response_content_type=res.get("content_type"),
            response_body_raw=res.get("raw_response"),
            response_body=resp_data,
            final_text=final_text,
            final_reasoning=final_reasoning,
            tool_calls=normalize_tool_calls(raw_tools),
            duration_sec=res.get("duration_sec"),
            app_slug=app_slug,
        )
        log['logged'] = True
    except Exception as e:
        logger.error(f"DB Insert Failed: {e}")


def build_request_store(request: Request, body: bytes, store: dict):
    """Synchronously capture request details into `store`. Pure (no DB I/O) so
    it can run once on the request path before the response is produced — the
    actual insert happens later off the response path via process_log()."""
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


async def stream_ollama_response(
        response: httpx.Response, start_time: float, store: dict):
    full_body = bytearray()
    content_type = response.headers.get("content-type", "").lower()
    global_timeout = get_setting_int("GLOBAL_TIMEOUT", 150)

    try:
        # Wrap the stream consumption in a timeout
        async for chunk in response.aiter_bytes():
            if time.time() - start_time > global_timeout:
                logger.error(f"Streaming exceeded {global_timeout}s timeout.")
                break
            full_body.extend(chunk)
            yield chunk

        duration = time.time() - start_time
        # httpx's aiter_bytes() already decodes Content-Encoding (gzip/deflate/
        # br/zstd via the httpx[brotli,zstd] extras), so full_body holds the
        # decoded SSE/NDJSON and the client receives it as identity.
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

            json_str = line
            if not is_ndjson:
                if line.startswith('data: '):
                    json_str = line[6:]
                else:
                    continue

            try:
                data = json.loads(json_str)
                # 1. Anthropic Stream
                if data.get("type") == "content_block_delta":
                    delta = data.get("delta", {})
                    d_type = delta.get("type")
                    if d_type == "text_delta":
                        content_acc.append(delta.get("text", ""))
                    elif d_type == "thinking_delta":
                        reasoning_acc.append(delta.get("thinking", ""))
                    elif d_type == "input_json_delta":
                        idx = data.get("index", 0)
                        if idx not in tool_call_map:
                            tool_call_map[idx] = {
                                "id": None, "name": "", "arguments": ""}
                        tool_call_map[idx]["arguments"] += delta.get(
                            "partial_json", "")
                elif data.get("type") == "content_block_start":
                    block = data.get("content_block", {})
                    if block.get("type") == "tool_use":
                        idx = data.get("index", 0)
                        tool_call_map[idx] = {
                            "id": block.get("id"),
                            "name": block.get("name"), "arguments": ""}

                # --- Handle Ollama Native NDJSON Format ---
                elif is_ndjson and data.get("message"):
                    msg = data.get("message")
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
                elif "choices" in data:
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
    finally:
        # Single writer for the streaming path. store["request"] was captured
        # synchronously in proxy() before streaming began, so this logs even if
        # the client disconnects mid-stream. process_log() no-ops if there's no
        # response yet (e.g. an early parse failure).
        await process_log(store)
        await response.aclose()


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy(request: Request, path: str):
    start_time = time.time()
    body = await request.body()
    req_store = {}

    # Config not yet loaded (e.g. proxy started before Postgres on reboot).
    # Return a clear, retryable 503 instead of forwarding with empty config.
    if not _config_loaded:
        return Response(
            content="Proxy is starting up (configuration not yet loaded). Retry shortly.",
            status_code=503,
            headers={"Retry-After": "5"})

    # Capture request details ONCE, synchronously, before any I/O. This is the
    # single source of req_store["request"] for both stream and non-stream
    # paths, so logging never races the response (the old code populated it in
    # a BackgroundTask that could be dropped on client disconnect).
    build_request_store(request, body, req_store)

    # Resolve target app
    app_slug, target_base_url, remaining_path = _resolve_app(path)
    req_store["app_slug"] = app_slug

    if not target_base_url:
        return Response(
            content="No target URL configured. Set BASE_URL in settings or create an app.",
            status_code=502)

    # Get dynamic settings
    global_timeout = get_setting_int("GLOBAL_TIMEOUT", 150)
    max_retries = get_setting_int("MAX_RETRIES", 3)
    base_delay = get_setting_float("BASE_DELAY", 3.0)

    # Get/create client for target
    target_client = _get_client(target_base_url)

    # Header Preparation.
    #  - 'host': httpx sets the correct Host from the target base_url; forwarding
    #    the inbound 'localhost:8080' breaks vhost routing / TLS SNI upstream.
    #  - 'content-length': httpx recomputes it from `content=body`; forwarding a
    #    stale value risks a mismatch.
    # We deliberately KEEP the client's 'accept-encoding' so the upstream link
    # may use compression (gzip/deflate/br/zstd). httpx transparently decodes it
    # — via aiter_bytes() when streaming and .content when not — so we forward a
    # decoded (identity) body to the client and strip the stale encoding headers.
    fwd_headers = {k: v for k, v in request.headers.items()
                   if k.lower() not in ('host', 'content-length')}

    try:
        # 1. Retry and Timeout Logic for the Initial Connection
        response = None
        for attempt in range(max_retries):
            try:
                # Use remaining_path (with app- prefix stripped)
                forward_path = f"/{remaining_path}" if remaining_path else "/"
                req = target_client.build_request(
                    request.method,
                    forward_path,
                    headers=fwd_headers,
                    content=body,
                    params=request.query_params
                )
                # Ensure the network request doesn't hang forever
                response = await asyncio.wait_for(
                    target_client.send(req, stream=True), timeout=global_timeout)

                if response.status_code == 429:
                    logger.warning(f"Rate Limited (429). Attempt {attempt+1}")
                    await response.aclose()
                    await asyncio.sleep(
                        base_delay * (2 ** attempt) + random.uniform(0, 1))
                    continue
                break
            except asyncio.TimeoutError:
                logger.error(
                    "Request timed out during connection "
                    f"(Attempt {attempt+1})")
                if attempt == max_retries - 1:
                    raise
            except Exception as e:
                if attempt == max_retries - 1:
                    raise e
                await asyncio.sleep(1)

        # 2. Handle Response
        is_stream = "json" not in response.headers.get("content-type", "") or \
                    (json.loads(body).get("stream") if body else False)

        if is_stream:
            # The streaming generator's `finally` is the single log writer;
            # req_store["request"] is already populated above.
            return StreamingResponse(
                stream_ollama_response(response, start_time, req_store),
                status_code=response.status_code,
                media_type=response.headers.get("content-type"),
            )
        else:
            # Wrap standard reading in a timeout
            await asyncio.wait_for(response.aread(), timeout=global_timeout)
            duration = time.time() - start_time

            # httpx auto-decodes response.content (gzip/deflate/br/zstd when the
            # relevant extras are installed). The outgoing headers must therefore
            # NOT advertise the original Content-Encoding, and Content-Length must
            # be recomputed — otherwise the client tries to re-decode plain bytes.
            out_headers = {k: v for k, v in response.headers.items()
                           if k.lower() not in ('content-encoding', 'content-length')}

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
            # Defer the DB insert off the response path so the client isn't
            # blocked on a write.
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers=out_headers,
                background=BackgroundTask(process_log, req_store))

    except asyncio.TimeoutError:
        return Response(
            content=f"Request exceeded {global_timeout} sec timeout",
            status_code=504)
    except Exception as e:
        logger.exception("Proxy Error")
        return Response(
            content=f"Internal Proxy Error: {str(e)}", status_code=502)

if __name__ == "__main__":
    logger.info(f'PROXY_HOST      : {PROXY_HOST}')
    logger.info(f'PROXY_PORT      : {PROXY_PORT}')
    logger.info(f'DATABASE_URL    : {DATABASE_URL}')
    uvicorn.run("main:app", host=PROXY_HOST, port=PROXY_PORT, reload=False)
