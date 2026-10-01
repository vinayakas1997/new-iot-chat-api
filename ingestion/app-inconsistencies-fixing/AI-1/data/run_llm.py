"""Call qwen36-35B with prompt.md (SYSTEM -> system msg, USER -> user msg).
Trial: python3 run_llm.py trial
Bulk:  python3 run_llm.py all
Writes response.json + run.log per folder. Skips folders that already have
a valid response.json (re-run safe).
"""
import base64
import datetime, json, os, sys, urllib.request

DATA = os.path.dirname(os.path.abspath(__file__))
BASE = "http://localhost:8009/v1/chat/completions"
MODEL = "qwen36-35B"
PROMPT_VERSION = "chart-v2"


def split_prompt(path):
    with open(path) as f:
        text = f.read()
    head, user = text.split("## USER", 1)
    system = head.split("## SYSTEM", 1)[1].strip()
    return system.strip(), user.strip()


def call(system, user, images):
    parts = [{"type": "text", "text": user}]
    for img_path in images:
        with open(img_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        parts.append({"type": "image_url",
                      "image_url": {"url": "data:image/png;base64," + b64}})
    body = json.dumps({
        "model": MODEL,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": parts}],
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }).encode()
    req = urllib.request.Request(
        BASE, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode())


def run(folder, label):
    resp_path = os.path.join(folder, "response.json")
    if os.path.isfile(resp_path):
        try:
            with open(resp_path) as f:
                json.load(f)
            print("skip (valid response exists): %s" % label)
            return True
        except json.JSONDecodeError:
            pass
    system, user = split_prompt(os.path.join(folder, "prompt.md"))
    images = [os.path.join(folder, "charts", "base-trend.png"),
              os.path.join(folder, "charts", "base-split.png")]
    for p in images:
        assert os.path.isfile(p), "missing chart image: %s" % p
    started = datetime.datetime.now(datetime.timezone.utc)
    try:
        raw = call(system, user, images)
        text = raw["choices"][0]["message"]["content"]
        parsed = json.loads(text)
    except Exception as e:
        print("FAIL %s: %s" % (label, e))
        with open(os.path.join(folder, "run.log"), "a") as f:
            f.write("%s FAIL %s\n" % (started.isoformat(), e))
        return False
    with open(resp_path, "w") as f:
        json.dump(parsed, f, ensure_ascii=False, indent=1)
    ok_c = isinstance(parsed.get("candidates"), list)
    ok_q = isinstance(parsed.get("questions"), list)
    with open(os.path.join(folder, "run.log"), "w") as f:
        f.write("started: %s\nmodel: %s\nprompt_version: %s\n"
                "has_candidates: %s\nhas_questions: %s\n" % (
                    started.isoformat(), MODEL, PROMPT_VERSION, ok_c, ok_q))
    print("%s: candidates=%s questions=%s n_cand=%s n_q=%s" % (
        label, ok_c, ok_q,
        len(parsed.get("candidates", [])), len(parsed.get("questions", []))))
    return True


def targets(mode):
    if mode == "trial":
        return [(os.path.join(DATA, "day", "2026-08-04"), "day/2026-08-04")]
    out = []
    day_root = os.path.join(DATA, "day")
    for date in sorted(os.listdir(day_root)):
        folder = os.path.join(day_root, date)
        if os.path.isfile(os.path.join(folder, "prompt.md")):
            out.append((folder, "day/" + date))
    out.append((os.path.join(DATA, "month"), "month"))
    return out


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "trial"
    ok = True
    for folder, label in targets(mode):
        ok = run(folder, label) and ok
    sys.exit(0 if ok else 1)
