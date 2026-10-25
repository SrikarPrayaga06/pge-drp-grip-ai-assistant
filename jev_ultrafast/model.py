"""TypeSafe makes choices; an optional small OpenAI-compatible model writes field values."""

import json
import math
import os
import time

import httpx

from .questions import NEXT_ACTION, TARGET, TEXT_VALUE

CLIENT = httpx.Client(http2=True, timeout=25)


def post_json(url, key, body):
    for attempt in range(3):
        try:
            response = CLIENT.post(url, json=body, headers={"Authorization": f"Bearer {key}"})
        except httpx.HTTPError:
            raise RuntimeError("Model connection failed; no action executed.") from None
        if response.status_code in {429, 529, 503} and attempt < 2:
            time.sleep(0.5 * 2**attempt)
            continue
        if response.is_error:
            raise RuntimeError(f"Model provider returned HTTP {response.status_code}; no action executed.")
        return response.json()
    raise RuntimeError("Model unavailable")


def validate_choice(answer, ids):
    try:
        probabilities = answer["probabilities"]
        numbers = [*probabilities.values(), answer["confidence"]]
        valid = (
            answer["choice"] in ids
            and set(probabilities) == set(ids)
            and all(type(n) in (int, float) and math.isfinite(n) and 0 <= n <= 1 for n in numbers)
            and abs(sum(probabilities.values()) - 1) < 0.02
            and probabilities[answer["choice"]] >= max(probabilities.values()) - 1e-6
        )
    except (KeyError, TypeError, ValueError):
        valid = False
    if not valid:
        raise ValueError("Invalid TypeSafe response; no action executed.")
    return answer


def action_space(actions):
    """One index per observed element; each operation has its own valid target choices."""
    elements, indices, targets, controls = [], {}, {}, {}
    operations = {"click": "CLICK", "fill": "TYPE_TEXT", "select": "SELECT"}
    for action in actions:
        kind = action["kind"]
        if kind not in operations:
            controls[action["id"].upper()] = action
            continue
        node = action["node"]
        if node not in indices:
            index = str(len(elements) + 1)
            indices[node] = index
            element = {k: action[k] for k in ("role", "value", "checked", "selected", "expanded") if k in action}
            element.update(index=index, label=action["label"].split(" → ")[0], operations=[])
            if kind == "select":
                element["value"] = action.get("current_value", "")
                element["options"] = []
            elements.append(element)
        index = indices[node]
        operation = operations[kind]
        group = targets.setdefault(operation, {})
        element = elements[int(index) - 1]
        if operation not in element["operations"]:
            element["operations"].append(operation)
        target = index
        if kind == "select":
            target = f"{index}:{len(element['options']) + 1}"
            element["options"].append({"index": target, "label": action["label"], "value": action["value"]})
        group[target] = action
    return elements, targets, controls


def make_valid_answer(ids, selected_id):
    """Construct an answer dict with normalized probabilities that passes validate_choice."""
    id_list = list(ids)
    if selected_id not in id_list:
        selected_id = id_list[0] if id_list else ""
    n = len(id_list)
    if n <= 1:
        probs = {i: 1.0 for i in id_list}
        conf = 1.0
    else:
        rem = round(0.10 / (n - 1), 6)
        probs = {i: rem for i in id_list}
        probs[selected_id] = round(1.0 - rem * (n - 1), 6)
        conf = probs[selected_id]
    return {
        "choice": selected_id,
        "confidence": conf,
        "probabilities": probs,
    }


def choose_local(state, goal, history, elements, targets, controls, operations):
    """Locally hosted decision model using local LLM (e.g. Ollama llama3.2)."""
    base_url = os.environ.get("LOCAL_MODEL_BASE_URL", "http://localhost:11434/v1").rstrip("/")
    model_name = os.environ.get("LOCAL_MODEL_NAME", "llama3.2:latest")
    api_key = os.environ.get("LOCAL_MODEL_API_KEY", "ollama")

    elem_lines = []
    for el in elements:
        val = f' (value: "{el["value"]}")' if el.get("value") else ""
        elem_lines.append(f"[{el['index']}] {el.get('role', 'element')} \"{el['label']}\"{val}")
    elements_text = "\n".join(elem_lines) if elem_lines else "(No interactive elements detected)"

    op_lines = []
    for op, desc in operations.items():
        if op in targets:
            cands = list(targets[op].keys())
            op_lines.append(f"- {op}: {desc} (candidate targets: {cands})")
        else:
            op_lines.append(f"- {op}: {desc}")
    ops_text = "\n".join(op_lines)

    recent_lines = []
    for h in history[-5:]:
        act = h.get("action", "")
        txt = f' typed "{h.get("text")}"' if h.get("text") else ""
        chg = " (page changed)" if h.get("page_changed") else " (no change)"
        recent_lines.append(f"- {act}{txt}{chg}")
    history_text = "\n".join(recent_lines) if recent_lines else "(None)"

    system_prompt = f"""You are an ultrafast browser agent decision model.
Your task is to advance the goal from the current page using exactly ONE operation and (if applicable) ONE target element index.

Rules:
{NEXT_ACTION}
{TARGET}

You MUST respond ONLY with a valid JSON object with keys:
- "operation": ONE of the valid operations ({', '.join(operations.keys())})
- "target": string index of the chosen target element from candidates (or null if the operation has no targets)
- "reasoning": 1 brief sentence explaining the choice
"""

    user_prompt = f"""Goal: {goal}

Current Page:
- Title: {state.get('title', '')}
- URL: {state.get('url', '')}
- Text: {state.get('text', '')[:2500]}

Visible Elements:
{elements_text}

Available Operations:
{ops_text}

Recent Actions:
{history_text}
"""

    started = time.perf_counter()
    url = f"{base_url}/chat/completions"
    body = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.0,
        "max_tokens": 512,
    }

    raw = {}
    try:
        raw = post_json(url, api_key, body)
        content = raw["choices"][0]["message"]["content"]
        parsed = json.loads(content)
    except Exception:
        parsed = {}

    chosen_op = str(parsed.get("operation", "")).strip().upper()
    if chosen_op not in operations:
        if "CLICK" in operations and targets.get("CLICK"):
            chosen_op = "CLICK"
        elif "DONE" in operations:
            chosen_op = "DONE"
        else:
            chosen_op = next(iter(operations))

    answers = {
        "operation": make_valid_answer(operations, chosen_op)
    }

    chosen_target = None
    if chosen_op in targets:
        candidates = targets[chosen_op]
        cand_keys = list(candidates.keys())
        target_val = str(parsed.get("target", "")).strip()
        if target_val not in candidates:
            match = next((k for k in cand_keys if k == target_val or target_val in k), cand_keys[0])
            target_val = match
        chosen_target = target_val
        answers[f"{chosen_op.lower()}_target"] = make_valid_answer(candidates, chosen_target)

    # For all other heads in targets, generate speculative valid dummy heads
    for op, cands in targets.items():
        head_key = f"{op.lower()}_target"
        if head_key not in answers:
            answers[head_key] = make_valid_answer(cands, next(iter(cands)))

    return {
        "model": f"{model_name} (local)",
        "answers": answers,
        "usage": raw.get("usage", {}),
        "started": started,
    }


def choose(state, goal, history):
    elements, targets, controls = action_space(state["actions"])
    labels = {
        "CLICK": "Click an element, button, menu option, autocomplete suggestion, or calendar day.",
        "TYPE_TEXT": "Enter or replace text in an editable field. A small LLM will supply the value from the goal.",
        "SELECT": "Select an observed dropdown value.",
    }
    operations = {key: labels[key] for key in targets}
    operations.update({key: value["label"] for key, value in controls.items()})
    operations.update(DONE="Every requirement is visibly satisfied.", BLOCKED="No supported operation can progress.")
    questions = {
        "operation": {"type": "choice", "criteria": operations, "instructions": {"goal": goal, "rules": NEXT_ACTION}}
    }
    for operation, candidates in targets.items():
        questions[operation.lower() + "_target"] = {
            "type": "choice",
            "criteria": {
                index: {
                    "element": f"[{index}] {a['label']}",
                    "current_value": a.get("current_value", a.get("value", "")),
                    **{k: a[k] for k in ("role", "checked", "selected", "expanded") if k in a},
                }
                for index, a in candidates.items()
            },
            "instructions": {"goal": goal, "operation": operation, "rules": [NEXT_ACTION, TARGET]},
        }
    body = {
        "model": os.environ.get("TYPESAFE_MODEL", "jev-latest"),
        "state": {
            "page": {k: state[k] for k in ("url", "title", "text")},
            "elements": elements,
            "recent_actions": [
                {k: h.get(k) for k in ("action", "kind", "text", "page_changed")} for h in history[-10:]
            ],
        },
        "questions": questions,
    }

    use_local = (
        os.environ.get("USE_LOCAL_DECISION_MODEL", "").lower() in ("true", "1", "yes")
        or not os.environ.get("TYPESAFE_API_KEY")
    )

    if use_local:
        local_res = choose_local(state, goal, history, elements, targets, controls, operations)
        started = local_res["started"]
        result = {"answers": local_res["answers"], "model": local_res["model"], "usage": local_res["usage"]}
    else:
        started = time.perf_counter()
        result = post_json("https://api.typesafe.ai/v1/systemone", os.environ["TYPESAFE_API_KEY"], body)

    operation_answer = validate_choice(result["answers"].get("operation", {}), operations)
    operation = operation_answer["choice"]
    target = None
    target_answer = None
    probabilities = {}
    if operation in targets:
        # Unused target heads cannot cause an action. Validate the head selected by the operation.
        target_answer = validate_choice(result["answers"].get(operation.lower() + "_target", {}), targets[operation])
        target = target_answer["choice"]
        choice = targets[operation][target]["id"]
        probabilities = {a["id"]: target_answer["probabilities"][index] for index, a in targets[operation].items()}
    else:
        choice = controls[operation]["id"] if operation in controls else operation
        probabilities[choice] = operation_answer["probabilities"][operation]
    return {
        "choice": choice,
        "operation": operation,
        "target": target,
        "confidence": operation_answer["confidence"],
        "probabilities": probabilities,
        "operation_probabilities": operation_answer["probabilities"],
        "target_probabilities": target_answer["probabilities"] if target_answer else {},
        "target_confidence": target_answer["confidence"] if target_answer else None,
        "raw_answers": result["answers"],
        "model": result["model"],
        "usage": result.get("usage", {}),
        "latency_ms": round((time.perf_counter() - started) * 1000),
        "request": body,
    }


def field_context(goal, action, page, history):
    return {
        "goal": goal,
        "field": {k: action.get(k) for k in ("label", "role", "value")},
        "page": {"title": page["title"], "text": page["text"][:6000]},
        "recent_actions": [{k: h.get(k) for k in ("action", "text")} for h in history[-6:]],
    }


def field_text(context):
    use_local = (
        os.environ.get("USE_LOCAL_TEXT_MODEL", "").lower() in ("true", "1", "yes")
        or (os.environ.get("USE_LOCAL_DECISION_MODEL", "").lower() in ("true", "1", "yes") and not os.environ.get("TEXT_MODEL_API_KEY"))
    )
    if not use_local and not os.environ.get("TEXT_MODEL_API_KEY"):
        raise ValueError("TYPE_TEXT needs TEXT_MODEL_API_KEY; no text is hardcoded or guessed by the executor.")

    if use_local:
        key = os.environ.get("LOCAL_MODEL_API_KEY", "ollama")
        base = os.environ.get("LOCAL_MODEL_BASE_URL", "http://localhost:11434/v1").rstrip("/")
        model = os.environ.get("LOCAL_MODEL_NAME", "llama3.2:latest")
        reasoning = {}
    else:
        key = os.environ.get("TEXT_MODEL_API_KEY")
        base = os.environ.get("TEXT_MODEL_BASE_URL", "https://api.deepseek.com/v1").rstrip("/")
        model = os.environ.get("TEXT_MODEL", "deepseek-chat")
        reasoning = {"thinking": {"type": "disabled"}} if "api.deepseek.com/" in base else {"reasoning": {"effort": "low"}}
        if os.environ.get("TEXT_MODEL_REASONING") == "none":
            reasoning = {"reasoning": {"enabled": False}}

    started = time.perf_counter()
    result = post_json(
        base + "/chat/completions",
        key,
        {
            "model": model,
            "max_tokens": 1024,
            "response_format": {"type": "json_object"},
            **reasoning,
            "messages": [
                {"role": "system", "content": TEXT_VALUE},
                {
                    "role": "user",
                    "content": json.dumps(context),
                },
            ],
        },
    )
    try:
        output = json.loads(result["choices"][0]["message"]["content"])
        value = output.get("text")
        if not isinstance(value, str) or not value.strip() or len(value) > 2000:
            raise ValueError()
        if not use_local and set(output) != {"text"}:
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise ValueError("Text helper returned no valid field value; nothing typed.") from None
    return value, {
        "model": model,
        "latency_ms": round((time.perf_counter() - started) * 1000),
        "usage": result.get("usage", {}),
    }
