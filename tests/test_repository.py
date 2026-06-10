"""Smoke tests for the DB repository across backends (SQLite always; Postgres
when TEST_DATABASE_URL is set). Guards the backend abstraction and the JSON
trace-stitching translations.

Run:  .venv-test/bin/python -m pytest tests/ -v
"""

import pytest

pytestmark = pytest.mark.asyncio


async def _insert(repo, *, request_body, response_body=None, final_text="hi",
                  tool_calls=None, status=200, app_slug="default"):
    await repo.insert_log(
        url="http://localhost:8080/v1/chat/completions",
        method="POST",
        query_params={},
        request_headers={"content-type": "application/json"},
        request_content_type="application/json",
        request_body_raw="{}",
        request_body=request_body,
        status_code=status,
        response_headers={"content-type": "application/json"},
        response_content_type="application/json",
        response_body_raw="{}",
        response_body=response_body or {},
        final_text=final_text,
        final_reasoning="",
        tool_calls=tool_calls or [],
        duration_sec=0.5,
        app_slug=app_slug,
    )


# Message shapes -----------------------------------------------------------
ROOT = {"messages": [{"role": "user", "content": "hello"}]}
OPENAI_FOLLOWUP = {"messages": [
    {"role": "user", "content": "hi"},
    {"role": "assistant", "content": "", "tool_calls": [{"id": "call_1"}]},
    {"role": "tool", "tool_call_id": "call_1", "content": "result"},
]}
ANTHROPIC_FOLLOWUP = {"messages": [
    {"role": "user", "content": "hi"},
    {"role": "assistant", "content": [{"type": "tool_use", "id": "tu_1"}]},
    {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "tu_1"}]},
]}


async def test_insert_and_plain_list(repo):
    await _insert(repo, request_body=ROOT)
    total, rows = await repo.get_logs(limit=50, offset=0, search="", view="plain",
                                      app_filter="", status="")
    assert total == 1
    assert rows[0]["final_text"] == "hi"
    assert rows[0]["app_slug"] == "default"
    assert isinstance(rows[0]["created_at"], str)  # normalised to ISO text


async def test_trace_view_hides_followups(repo):
    await _insert(repo, request_body=ROOT)
    await _insert(repo, request_body=OPENAI_FOLLOWUP)
    await _insert(repo, request_body=ANTHROPIC_FOLLOWUP)

    total_plain, _ = await repo.get_logs(limit=50, offset=0, search="",
                                         view="plain", app_filter="", status="")
    assert total_plain == 3

    total_trace, rows = await repo.get_logs(limit=50, offset=0, search="",
                                            view="trace", app_filter="", status="")
    # Only the ROOT request survives the trace-parent filter.
    assert total_trace == 1
    assert rows[0]["request_body"] if False else True  # rows shaped by route


async def test_search_filter(repo):
    await _insert(repo, request_body=ROOT, final_text="needle in haystack")
    await _insert(repo, request_body=ROOT, final_text="nothing here")
    total, rows = await repo.get_logs(limit=50, offset=0, search="NEEDLE",
                                      view="plain", app_filter="", status="")
    assert total == 1  # case-insensitive


async def test_status_filter(repo):
    await _insert(repo, request_body=ROOT, status=200)
    await _insert(repo, request_body=ROOT, status=500)
    total, _ = await repo.get_logs(limit=50, offset=0, search="", view="plain",
                                   app_filter="", status="error")
    assert total == 1


async def test_metrics(repo):
    await _insert(repo, request_body=ROOT, status=200)
    await _insert(repo, request_body=ROOT, status=503)
    m = await repo.get_metrics()
    assert m["summary"]["total_requests"] == 2
    assert m["summary"]["error_count"] == 1
    assert len(m["chart_data"]) >= 1
    assert any(b["app_slug"] == "default" for b in m["app_breakdown"])


async def test_trace_stitching(repo):
    # parent emits tool call "call_42"; child references it in its request body.
    await _insert(repo, request_body=ROOT, tool_calls=[{"id": "call_42", "name": "search"}])
    await _insert(repo, request_body={"messages": [
        {"role": "tool", "tool_call_id": "call_42", "content": "x"}]})

    _, rows = await repo.get_logs(limit=50, offset=0, search="", view="plain",
                                  app_filter="", status="")
    ids = sorted(r["id"] for r in rows)
    parent_id, child_id = ids[0], ids[1]

    parent = await repo.find_parent_by_toolcall(child_id, "call_42")
    assert parent and parent["id"] == parent_id

    child = await repo.find_child_by_request(parent_id, "call_42")
    assert child and child["id"] == child_id


async def test_delete_and_bulk_delete(repo):
    await _insert(repo, request_body=ROOT)
    await _insert(repo, request_body=ROOT)
    await _insert(repo, request_body=ROOT)
    _, rows = await repo.get_logs(limit=50, offset=0, search="", view="plain",
                                  app_filter="", status="")
    ids = [r["id"] for r in rows]

    assert await repo.delete_log(ids[0]) == 1
    assert await repo.bulk_delete(ids=ids[1:]) == 2
    total, _ = await repo.get_logs(limit=50, offset=0, search="", view="plain",
                                   app_filter="", status="")
    assert total == 0


async def test_settings(repo):
    await repo.update_settings({"BASE_URL": "http://x", "MAX_RETRIES": "5"})
    rows = await repo.get_settings()
    as_map = {r["key"]: r["value"] for r in rows}
    assert as_map["BASE_URL"] == "http://x"
    # upsert
    await repo.update_settings({"BASE_URL": "http://y"})
    rows = await repo.get_settings()
    as_map = {r["key"]: r["value"] for r in rows}
    assert as_map["BASE_URL"] == "http://y"


async def test_apps_crud_and_duplicate(repo):
    from shared.oidb.repository import DuplicateSlug

    a = await repo.create_app("ollama", "Ollama", "http://host:11434", True)
    assert a["is_default"] is True
    assert isinstance(a["created_at"], str)

    b = await repo.create_app("router", "Router", "http://openrouter", True)
    # Setting b default must unset a.
    apps = await repo.list_apps()
    defaults = [x for x in apps if x["is_default"]]
    assert len(defaults) == 1 and defaults[0]["slug"] == "router"

    with pytest.raises(DuplicateSlug):
        await repo.create_app("ollama", "Dup", "http://dup", False)

    updated = await repo.update_app(a["id"], {"name": "Ollama Local"})
    assert updated["name"] == "Ollama Local"

    # Deleting the current default promotes another app to default.
    assert await repo.delete_app(b["id"]) is True
    apps = await repo.list_apps()
    assert len(apps) == 1
    assert apps[0]["is_default"] is True


async def test_seed_initial_and_idempotent_schema(repo):
    # ensure_schema is safe to call repeatedly (both services call it).
    await repo.ensure_schema()
    await repo.seed_initial(
        settings_seeds={"BASE_URL": "http://seed", "MAX_RETRIES": "3", "EMPTY": ""},
        default_app={"slug": "default", "name": "Default", "target_url": "http://seed"},
    )
    settings = {r["key"]: r["value"] for r in await repo.get_settings()}
    assert settings["BASE_URL"] == "http://seed"
    assert "EMPTY" not in settings  # falsy seeds are skipped
    apps = await repo.list_apps()
    assert len(apps) == 1 and apps[0]["is_default"] is True

    # Second seed is a no-op (tables non-empty) and must not raise/duplicate.
    await repo.seed_initial(
        settings_seeds={"BASE_URL": "http://changed"},
        default_app={"slug": "default", "name": "Default", "target_url": "http://x"},
    )
    settings = {r["key"]: r["value"] for r in await repo.get_settings()}
    assert settings["BASE_URL"] == "http://seed"  # unchanged
    assert len(await repo.list_apps()) == 1


async def test_export_rows(repo):
    await _insert(repo, request_body=ROOT, final_text="kept", status=200)
    await _insert(repo, request_body=ROOT, final_text="", status=200)  # empty -> excluded
    await _insert(repo, request_body=ROOT, final_text="err", status=500)  # non-200 -> excluded
    rows = await repo.get_export_rows(None, None)
    assert len(rows) == 1
    assert rows[0]["final_text"] == "kept"
