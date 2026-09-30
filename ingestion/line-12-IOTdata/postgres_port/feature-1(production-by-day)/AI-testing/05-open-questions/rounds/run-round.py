#!/usr/bin/env python3
"""Autonomous loop — round runner v1 (rules generator + ask solver + Gate-2 filing).

 round: propose (generator) -> ask each w/ debugTrace (solver)
        -> verdict per answer -> file/merge/drop/close (tickets API).

 Verdict rules v1:
   round+ok+rows>0, proposal has ticketId -> answer appended, ticket CLOSED (resolved)
   round+ok+rows>0, new source            -> FILE new ticket w/ evidence aiReason
   round+ok+0 rows                        -> FILE as empty-finding (empty is a finding)
   dropped/error, proposal has ticketId   -> CLOSE ticket as unanswerable + reason
   dropped/error, new source              -> DROP (log reason only, nothing filed)
 Worth rule v1: grounded answers file; only errors/drops are withheld.

 Bundles: 05-open-questions/rounds/<ts>/<i>-<source>/ with
   01-question.json (asked_by: generator/rules-v1 + source + reason),
   02-prompt-sent.md, 02b-attempts.jsonl, 03-response.md, 03b-sample.json,
   05-eval.md (auto-dimensions), 06-validator-verdict.md, 07-filing.md.
"""
import json, urllib.request, datetime, os, sys

APP = 'http://localhost:3100'
BASE = ('/home/somic_cps/Vina/new-iot-chat-api/ingestion/line-12-IOTdata/postgres_port'
        '/feature-1(production-by-day)/AI-testing/05-open-questions')
WINDOW = {"from": "2026-08-04T00:00:00+09:00", "to": "2026-08-05T00:00:00+09:00"}

def api(method, path, body=None):
    req = urllib.request.Request(APP + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json'}, method=method)
    return json.load(urllib.request.urlopen(req, timeout=280))

def main():
    line_id = sys.argv[1] if len(sys.argv) > 1 else 'line-12'
    cap = int(sys.argv[2]) if len(sys.argv) > 2 else 2
    ts = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H%M%SZ')
    rdir = f'{BASE}/rounds/{ts}'
    os.makedirs(rdir, exist_ok=True)
    prop = api('POST', '/api/ingest/loop/propose', {'lineId': line_id, 'max': cap})
    proposals = prop.get('proposals', [])
    print(f'round {ts}: {len(proposals)} proposals')
    log = []
    for i, p in enumerate(proposals):
        qd = f'{rdir}/{i}-{p["source"]}'
        os.makedirs(qd, exist_ok=True)
        json.dump({'asked_by': 'generator/rules-v1', 'proposal': p, 'window': WINDOW, 'at': ts},
                  open(f'{qd}/01-question.json', 'w'), ensure_ascii=False, indent=1)
        r = api('POST', '/api/ingest/playground/ask',
                {'lineId': line_id, 'message': p['question'], 'window': WINDOW, 'debugTrace': True})
        tr = r.pop('trace', [])
        if tr and 'promptFull' in tr[0]:
            open(f'{qd}/02-prompt-sent.md', 'w').write(tr[0]['promptFull'])
        with open(f'{qd}/02b-attempts.jsonl', 'w') as f:
            for e in tr:
                e2 = dict(e); e2.pop('promptFull', None)
                f.write(json.dumps(e2, ensure_ascii=False) + '\n')
        open(f'{qd}/03-response.md', 'w').write(
            f"# reply\n{r.get('reply')}\n\n# sql\n```sql\n{r.get('sql')}\n```\n\n# meta\n"
            f"type={r.get('type')} attempts={r.get('attempts')} rowCount={r.get('rowCount')}\n\n# steps\n"
            + "\n".join(f"- {s}" for s in r.get('steps', [])) + "\n")
        json.dump({'sample': r.get('sample')}, open(f'{qd}/03b-sample.json', 'w'),
                  ensure_ascii=False, indent=1)
        # --- Gate-2 verdict (v2: handoff ok=false is NOT success) ---
        is_round = r.get('type') == 'round'
        handed_off = is_round and r.get('ok') is False
        rows = r.get('rowCount') or 0
        ok = is_round and not handed_off and rows > 0
        empty_ok = is_round and not handed_off and rows == 0
        evidence = (f"Q: {p['question']}\nA: {r.get('reply')}\nSQL: {r.get('sql')}\n"
                    f"rows={r.get('rowCount')} attempts={r.get('attempts')}")
        if handed_off:
            verdict = 'HANDOFF (solver gave up, question stays open)'
            action = 'left open for next round; last SQL in editor'
        elif ok or empty_ok:
            verdict = 'FILE' + (' (empty-finding)' if empty_ok else '')
            if p.get('ticketId'):
                note = ('LOOP-RESOLVED ' + verdict + ': ' + str(r.get('reply'))[:500]
                        + ' SQL ran ' + str(r.get('rowCount')) + ' rows.')
                api('POST', f"/api/ingest/tickets/{p['ticketId']}/close", {'note': note})
                action = f"closed ticket #{p['ticketId']} as resolved"
            else:
                t = api('POST', '/api/ingest/tickets/open',
                        {'lineId': line_id, 'cardId': p.get('cardId'),
                         'title': f"[loop] {p['sourceRef']}: {p['question'][:120]}",
                         'aiReason': evidence[:1800], 'allowMultiple': True})
                action = f"filed ticket #{t['id']}"
        else:
            reason = r.get('reason') or r.get('reply') or r.get('type')
            verdict = f'DROP ({reason})'
            if p.get('ticketId'):
                api('POST', f"/api/ingest/tickets/{p['ticketId']}/close",
                    {'note': f'LOOP-DROPPED: {reason}'})
                action = f"closed ticket #{p['ticketId']} as unanswerable: {reason}"
            else:
                action = 'dropped, reason logged only'
        open(f'{qd}/07-filing.md', 'w').write(f'# Gate-2: {verdict}\n{action}\n')
        open(f'{qd}/06-validator-verdict.md', 'w').write(
            f"type={r.get('type')} attempts={r.get('attempts')} rows={r.get('rowCount')}\n"
            + "\n".join(json.dumps({k: e.get(k) for k in ('attempt', 'outcome', 'validatorVerdict')})
                         for e in tr) + "\n")
        open(f'{qd}/05-eval.md', 'w').write(
            f"# auto-eval: type={r.get('type')} rows={r.get('rowCount')} verdict={verdict}\n"
            f"human: TODO\n")
        print(f' [{i}] {p["source"]} -> {r.get("type")} rows={r.get("rowCount")} | {verdict} | {action}')
        log.append({'at': ts, 'qid': f'loop-{i}-{p["source"]}', 'source': p['source'],
                    'type': r.get('type'), 'rows': r.get('rowCount'), 'verdict': verdict,
                    'action': action})
    with open(f'{BASE}/rounds.jsonl', 'a') as f:
        for e in log:
            f.write(json.dumps(e) + '\n')
    print(f'done. bundles in {rdir}')

if __name__ == '__main__':
    main()
