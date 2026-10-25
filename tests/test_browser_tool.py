"""Integration tests for execute_ultrafast_browser_task and local browser automation."""

import json
import pytest
from chatbot.tools import execute_ultrafast_browser_task


def test_browser_task_validation():
    """Verify input validation for browser task tool."""
    res_raw = execute_ultrafast_browser_task.invoke({"url": "", "goal": ""})
    res = json.loads(res_raw)
    assert "error" in res


def test_browser_task_local_execution():
    """Verify end-to-end execution of a local browser task on the planner page."""
    res_raw = execute_ultrafast_browser_task.invoke({
        "url": "http://127.0.0.1:8000/planner",
        "goal": "Inspect the Workflows button",
        "max_steps": 2,
    })
    res = json.loads(res_raw)
    assert "status" in res
    assert res["status"] in ("ready", "done", "blocked", "predicted")
    assert "PG&E" in res.get("title", "")
    assert res.get("steps_completed", 0) >= 1
    assert len(res.get("history", [])) >= 1
