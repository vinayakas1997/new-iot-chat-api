"""Part-1 probe runner: envelope + image -> :8009, reply printed to stdout.

Usage: python3 send_part1.py <name> <image.png> <fixture.json> [system.txt]
Saves part1/responses/<name>.json (envelope + system file + reply) for
consistency checks across runs. Trial D equivalent for text-only calls is
out of scope for Part 1.
Internet fix: IMAGE FIRST in the user content blocks (measured +13-18% on
chart parsing) — the model sees, then reads instructions.
"""
import base64
import json
import os
import sys
import urllib.request
from build_envelope import build

BASE = "/home/somic_cps/Vina/new-iot-chat-api/context-building-new/part1"


def main() -> None:
    name, image, fixture = sys.argv[1], sys.argv[2], sys.argv[3]
    system_file = sys.argv[4] if len(sys.argv) > 4 else "system_v2.txt"
    system = open(f"{BASE}/{system_file}").read()
    fx = json.load(open(fixture))
    user_text = build(fx)
    png = base64.b64encode(open(image, "rb").read()).decode()
    payload = {
        "model": "qwen36-35B",
        "temperature": 0.2,
        "max_tokens": 1500,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": "data:image/png;base64," + png}},
                {"type": "text", "text": user_text},
            ]},
        ],
    }
    req = urllib.request.Request(
        "http://localhost:8009/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        resp = json.load(r)
    reply = resp["choices"][0]["message"]["content"]
    os.makedirs(f"{BASE}/responses", exist_ok=True)
    json.dump(
        {"trial": name, "systemFile": system_file, "fixture": fixture,
         "image": image, "userText": user_text, "reply": reply},
        open(f"{BASE}/responses/{name}.json", "w"),
        indent=1,
    )
    print(f"===== TRIAL {name} ENVELOPE CHARS: {len(user_text)} SYSTEM CHARS: {len(system)} (saved responses/{name}.json) =====")
    print(f"===== TRIAL {name} REPLY =====")
    print(reply)


main()
