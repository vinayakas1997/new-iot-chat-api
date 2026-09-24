"""Sender for the SQL-assistant demo harness: envelope + system -> :8009.

Usage: python3 send_ask.py <name> [--system ask_system_v1.txt] [build_ask.py args...]
Example:
  python3 send_ask.py T1 --line line-smoke --question "hourly average of temp, last 7 days"
Saves sql-assistant-working/responses/<name>.json (envelope + reply) and
responses/<name>.prompt.md (complete prompt as sent: system inlined + hash +
full envelope). Grade against the pair, never the reply alone.
"""
import hashlib
import json
import os
import subprocess
import sys
import urllib.request

BASE = "/home/somic_cps/Vina/new-iot-chat-api/sql-assistant-working"


def main() -> None:
    name = sys.argv[1]
    rest = sys.argv[2:]
    system_file = "ask_system_v1.txt"
    if rest[:1] == ["--system"]:
        system_file = rest[1]
        rest = rest[2:]
    system = open(f"{BASE}/{system_file}").read()
    env = subprocess.run(
        [sys.executable, f"{BASE}/build_ask.py", *rest],
        capture_output=True, text=True, check=True,
    ).stdout
    payload = {
        "model": "qwen36-35B",
        "temperature": 0.2,
        "max_tokens": 1500,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": env},
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
        {"trial": name, "systemFile": system_file, "buildArgs": rest,
         "userText": env, "reply": reply},
        open(f"{BASE}/responses/{name}.json", "w"),
        indent=1,
    )
    digest = hashlib.sha256(system.encode()).hexdigest()[:12]
    md = "\n".join([
        f"# Trial {name} — complete prompt as sent",
        "",
        "## 1. system",
        f"file: `{system_file}` · chars: {len(system)} · sha12: `{digest}`",
        "",
        "```",
        system,
        "```",
        "",
        "## 2. user: envelope (sections A+B+C+D)",
        f"chars: {len(env)} · built live from :3100 (columnMeta + ranges)",
        "",
        "```",
        env,
        "```",
        "",
    ])
    open(f"{BASE}/responses/{name}.prompt.md", "w").write(md)
    print(f"===== TRIAL {name} ENVELOPE CHARS: {len(env)} SYSTEM CHARS: {len(system)} (saved responses/{name}.json) =====")
    print("===== REPLY =====")
    print(reply)


if __name__ == "__main__":
    main()
