"""Send one text trial: system.txt + prompt_<trial>.txt -> :8009 (qwen36-35B).
Usage: python3 send_trial.py <A|B>
Saves responses/<trial>.json with prompt echo + raw reply. Blind: never
reads expected.json.
"""
import json
import os
import sys
import urllib.request

BASE = "/home/somic_cps/Vina/new-iot-chat-api/ingestion/suggest-charts"


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
    user_text = open(f"{BASE}/prompt_{trial}.txt").read()
    payload = {
        "model": "qwen36-35B",
        "temperature": 0.2,
        "max_tokens": 1500,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_text},
        ],
    }
    resp = post(payload)
    reply = resp["choices"][0]["message"]["content"]
    os.makedirs(f"{BASE}/responses", exist_ok=True)
    json.dump(
        {"trial": trial, "userText": user_text, "reply": reply},
        open(f"{BASE}/responses/{trial}.json", "w"),
        indent=1,
    )
    print(f"===== TRIAL {trial} REPLY =====")
    print(reply)


main()
