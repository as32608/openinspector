# 🔭 OpenInspector

A lightweight, local-first observability proxy and dashboard designed to intercept, log, and trace LLM interactions. OpenInspector acts as a transparent middleman, offering full visibility into agentic workflows, tool executions, and latency metrics **without requiring you to change a single line of your application code.**


## ✨ Features

* **Zero-Instrumentation Drop-in Proxy:** Unlike standard observability frameworks (e.g., LangSmith, DataDog) that require you to install heavy SDK wrappers or inject callback handlers, OpenInspector works purely at the network level. Just change your `BASE_URL`.
  * *Perfect for:* No-code/Low-code platforms (n8n, Flowise, Langflow) or pre-compiled autonomous agents (like OpenClaw, etc.) where injecting custom Python/JS instrumentation code is impractical or impossible.

* **Dynamic UI & Configuration:**
  * **Dynamic Multi-App Routing:** Deploy the proxy once and handle multiple LLM targets concurrently by routing through `/app-{slug}` endpoints or the default app configuration. Manage all targets from the dashboard without touching `.env` files or restarting services!

  <table>
    <tr>
      <td><img src="resources/dynamic_config1.png" width="100%"/></td>
    </tr>
  </table>

  * **Revamped Dashboard:** A modern, feature-rich user interface designed for maximum visibility into your agent workflows.
  * **Raw Database Inspection & Management:** View raw database records directly in the UI and easily delete unnecessary logs to maintain a clean trace history.
  
* **Agent Trace Linking:** Automatically stitches together multi-step agent tool calls and LLM responses into a unified, visually readable timeline.
  
  ![Agent Trace Timeline](resources/trace_view.png)

* **Intelligent Stream Parsing:** Extracts hidden reasoning/thought blocks and fragmented tool-calls from complex stream payloads (Supports OpenAI, OpenRouter, and native Ollama formats).
* **Resilience & Protection:** 
  * **Rate Limits:** Built-in exponential backoff and retry logic automatically handles `429 Too Many Requests` errors from providers like OpenRouter.
  * **Timeouts:** Includes a strict global timeout monitor to automatically sever connections if a local model hallucinates and gets stuck in an infinite generation loop.
* **Fine-tuning Dataset Curation:** 1-click export of clean, successful conversation traces into OpenAI-compatible JSONL format (`{"messages": [...]}`). Use this to easily capture data from expensive frontier models (GPT-4, Claude) to fine-tune your own smaller, local models.
* **Local First:** Everything runs locally via Docker Compose. Your sensitive prompts and data never leave your machine.


## 🚀 Quick Start

### 1. Prerequisites
Ensure you have [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed on your system.

### 2. Clone the Repository
```bash
git clone https://github.com/as32608/openinspector.git
cd openinspector
```

### 3. Setup Configuration
Create a `.env` file from the provided example:
```bash
cp .env.example .env
```
With the new dynamic configuration UI, the `.env` file primarily serves to seed the initial database connection. Once the stack is running, you can manage LLM target providers and app routing directly via the dashboard.

#### Database backend (Postgres or SQLite)
OpenInspector defaults to the bundled **PostgreSQL** service. For a lighter, zero-dependency setup you can switch to **SQLite** — a single shared file (WAL mode) used by both the proxy and dashboard, with no Postgres container required. Set in your `.env`:
```bash
DB_BACKEND=sqlite          # default: postgres
# SQLITE_PATH=/data/openinspector.db   # shared oi_data volume (default)
```
Both backends are schema-compatible; trace stitching, metrics, search and export behave identically. SQLite is ideal for single-user local use; Postgres scales better and adds GIN-indexed JSON search.

#### Resilience settings (also editable live in the UI)
| Setting | Default | Purpose |
| :--- | :--- | :--- |
| `GLOBAL_TIMEOUT` | 150 | Hard cap (s) on total request/stream duration. |
| `READ_TIMEOUT` | 60 | Per-read timeout (s) — detects a stalled upstream mid-stream. |
| `MAX_RETRIES` / `BASE_DELAY` | 3 / 3.0 | Exponential backoff on `429`s. |
| `UVICORN_WORKERS` | 2 | Proxy worker processes (concurrency under load). |

### 4. Start the Stack
We provide a convenient CLI tool to manage the stack.
```bash
# Make the CLI executable (first time only)
chmod +x open-inspector.sh

# Start the services
./open-inspector.sh start
```

## 🛠️ Usage

To use the proxy, you do not need to install any new packages. Simply point your existing AI application to the proxy port (8080 by default).

### Example using the OpenAI Python SDK with OpenRouter (OpenAI Compatible API):
```python
from openai import OpenAI

base_url = "http://localhost:8080", # To target a specific app setup in UI, use "http://localhost:8080/app-slug"
api_key = "your-actual-api-key"

client = OpenAI(
    base_url=base_url
    api_key=api_key    # Forwarded securely to the destination
)

response = client.chat.completions.create(
    model="stepfun/step-3.5-flash:free",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

### Example using the OpenAI Python SDK with Ollama:
```python
from openai import OpenAI

base_url = "http://localhost:8080/v1", # Target URL configured in UI should be http://host.docker.internal:11434
# Or
# base_url = "http://localhost:8080", # Target URL configured in UI should be http://host.docker.internal:11434/v1

api_key = "dummy_key_does_not_matter_for_ollama"

client = OpenAI(
    base_url=base_url
    api_key=api_key    # Forwarded securely to the destination
)

response = client.chat.completions.create(
    model="qwen3.5:9b",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

> Note: OpenAI SDK expects the base_url to be ending with version, example "/v1" while Langchain usually expects one that doesn't end with version. So adjust either the target setup in the UI or base_url in the code accordingly.

 
### Usage with Claude Code

- If using Claude Code with **Anthropic**, set the target URL in UI for your app to the Anthropic URL:

  `Target URL: https://api.anthropic.com`

  Also, set environment variables in your terminal (or global) as:
  ```shell
  export ANTHROPIC_BASE_URL=http://localhost:8080
  ```

- If using Claude Code with **OpenRouter**, set the target URL in UI for your app to the OpenRouter API URL:
  
  `Target URL: https://openrouter.ai/api`

  Also, set environment variables in your terminal (or global) as:
  ```shell
  export ANTHROPIC_AUTH_TOKEN=your_open_router_api_key
  export ANTHROPIC_API_KEY=""
  export ANTHROPIC_BASE_URL=http://localhost:8080
  # Optionally set model to any model available locally
  export ANTHROPIC_MODEL=any_open_router_model_example_arcee-ai/trinity-large-preview:free
  ```

- If using Claude Code with Local **Ollama**, set the target URL in UI for your app to the Ollama API URL:

  `Target URL: http://host.docker.internal:11434`

  Also, set environment variables in your terminal (or global) as:
  ```shell
  export ANTHROPIC_AUTH_TOKEN=ollama
  export ANTHROPIC_API_KEY=""
  export ANTHROPIC_BASE_URL=http://localhost:8080
  # Optionally set model to any model available locally
  export ANTHROPIC_MODEL=qwen3.5:9b
  ```

> Note: Thanks to the dynamic configuration UI, you no longer need to restart services when adding or modifying target application endpoints!

 **Sample Trace Snippets from Claude Code execution**

<table>
  <tr>
    <td><img src="resources/claude_ex_1.png" width="100%"/></td>
    <td><img src="resources/claude_ex_2.png" width="100%"/></td>
  </tr>
  <tr>
    <td><img src="resources/claude_ex_3.png" width="100%"/></td>
    <td><img src="resources/claude_ex_4.png" width="100%"/></td>
  </tr>
</table>

> . . . Only few screenshots included for reference (complete trace has more info)

## 💻 The CLI Tool (`open-inspector.sh`)
Manage your environment effortlessly using the bundled CLI:

| Command | Description |
| :--- | :--- |
| `./open-inspector.sh start` | Builds and starts the Proxy, API, Database, and UI |
| `./open-inspector.sh stop` | Shuts down the stack |
| `./open-inspector.sh status` | Shows running containers and their health |
| `./open-inspector.sh logs` | Tails the logs for all services |
| `./open-inspector.sh logs proxy` | Tails the logs for a specific service (e.g., `proxy`) |
| `./open-inspector.sh config` | Opens your `.env` file in your default editor |
| `./open-inspector.sh dashboard`| Opens the analytics UI in your web browser |

## 🏗️ Architecture

OpenInspector is built with a modular, asynchronous architecture designed for high throughput and low overhead.

![Architecture](resources/architecture.png)

* **Proxy (`FastAPI`):** Intercepts HTTP requests, handles rate-limit retries, enforces timeouts, transparently forwards/decodes compressed responses (gzip/deflate/br/zstd), normalizes SSE/NDJSON streams, and writes raw data to the database off the response path.
* **Dashboard API (`FastAPI`):** Read/admin API that stitches bidirectional agent traces and aggregates metrics.
* **Frontend (`React + Vite + Tailwind`):** The visualization layer for timeline reconstruction and trace inspection. Served by nginx, which reverse-proxies `/api` to the dashboard API — so the browser uses a single origin (no hardcoded host, no CORS).
* **Database (pluggable):** A thin adapter (`shared/oidb`) backs all storage with either **PostgreSQL** (default) or **SQLite**, selected via `DB_BACKEND`. All SQL — including the JSON trace-stitching queries — is translated per backend.

### Running tests
The data layer has a backend-parametrized smoke suite:
```bash
pip install -r requirements-dev.txt
pytest tests/            # SQLite by default; set TEST_DATABASE_URL to also run Postgres
```
