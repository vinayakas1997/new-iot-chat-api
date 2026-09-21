"""Send one vision trial: system.txt + filled user block + PNG -> :8009.
Usage: python3 send_trial.py <trial> <image> <meta.json>   (trial e.g. A)
Saves responses/<trial>.json with request echo + raw reply. Blind: never
reads truth.json / expected.json.
Usage (text-only step2): python3 send_trial.py D --text step2_prompt.txt
"""
import base64
import json
import sys
import urllib.request

BASE = "/home/somic_cps/Vina/new-iot-chat-api/ingestion/context-step-1"


def fill(template: str, meta: dict) -> str:
    s = template
    s = s.replace("{chartType}", meta.get("chartType", ""))
    s = s.replace("{title}", meta.get("title", ""))
    s = s.replace("{resolution}", meta.get("resolution", ""))
    s = s.replace("{from}", meta.get("window", {}).get("from", ""))
    s = s.replace("{to}", meta.get("window", {}).get("to", ""))
    s = s.replace("{rows}", str(meta.get("provenance", {}).get("rows", "")))
    s = s.replace("{timezone}", meta.get("timezone", ""))
    s = s.replace("{xTitle}", meta.get("xTitle", ""))
    s = s.replace("{yTitle}", meta.get("yTitle", ""))
    series = "; ".join(
        f"{x.get('column')} ({x.get('label')}, unit {x.get('unit')}, shown {x.get('shown')})"
        for x in meta.get("series", [])
    )
    s = s.replace("{series}", series)
    st = meta.get("stats", {})
    s = s.replace("{stats}", json.dumps(st))
    s = s.replace("{aggregationRule}", meta.get("aggregationRule", ""))
    s = s.replace("{threshold}", str(meta.get("threshold", "")))
    s = s.replace("{bucketNote}", meta.get("bucketNote", ""))
    s = s.replace("{breachDirection}", meta.get("breachDirection", "above"))
    s = s.replace("{extractHint}", meta.get("extractHint", ""))
    qv = meta.get("quirkVerdicts", {})
    s = s.replace("{quirkVerdicts}", json.dumps(qv))
    s = s.replace("{priorDigests}", " | ".join(meta.get("priorDigests", [])))
    s = s.replace("{historyPack}", json.dumps(meta.get("historyPack", {})))
    s = s.replace("{openTickets}", json.dumps(meta.get("openTickets", [])))
    return s


def post(payload: dict) -> dict:
    req = urllib.request.Request(
        "http://localhost:8009/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def main() -> None:
    trial = sys.argv[1]
    system = open(f"{BASE}/system.txt").read()
    if sys.argv[2] == "--text":
        user_text = open(f"{BASE}/{sys.argv[3]}").read()
        content = [{"type": "text", "text": user_text}]
        meta_name = None
    else:
        image, meta_name = sys.argv[2], sys.argv[3]
        meta = json.load(open(f"{BASE}/{meta_name}"))
        template = open(f"{BASE}/user_template.txt").read()
        user_text = fill(template, meta)
        png = base64.b64encode(open(f"{BASE}/{image}", "rb").read()).decode()
        content = [
            {"type": "text", "text": user_text},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + png}},
        ]
    payload = {
        "model": "qwen36-35B",
        "temperature": 0.2,
        "max_tokens": 1500,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": content},
        ],
    }
    resp = post(payload)
    reply = resp["choices"][0]["message"]["content"]
    import os
    os.makedirs(f"{BASE}/responses", exist_ok=True)
    json.dump(
        {"trial": trial, "meta": meta_name, "userText": content[0]["text"], "reply": reply},
        open(f"{BASE}/responses/{trial}.json", "w"),
        indent=1,
    )
    print(f"===== TRIAL {trial} REPLY =====")
    print(reply)


main()
