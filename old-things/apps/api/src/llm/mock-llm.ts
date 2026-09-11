/**
 * Offline LLM. It is intentionally not "smart" — it produces deterministic,
 * inspectable output so tests and demos are stable:
 *
 *  - If any tool is provided, it calls every tool once with a best-effort input
 *    parsed from the last user message, then summarises the tool outputs.
 *  - For schedule-parsing / extraction callers it recognises a directive in the
 *    system prompt ("Respond ONLY with JSON") and returns a minimal valid shape.
 */
import type { GenerateOptions, LlmPort, LlmTool } from './port.js';

function lastUser(opts: GenerateOptions): string {
  for (let i = opts.messages.length - 1; i >= 0; i--) {
    if (opts.messages[i]!.role === 'user') return opts.messages[i]!.content;
  }
  return '';
}

const MOCK_TREND_SQL =
  "SELECT line_id, date_trunc('hour', ts) AS hour, sum(units_produced) units_produced, " +
  'sum(units_scrapped) units_scrapped, avg(oee) avg_oee, sum(downtime_min) downtime_min ' +
  "FROM production_rows WHERE line_id = 'line-3' GROUP BY 1,2 ORDER BY 2";

async function runTools(tools: LlmTool[], query: string): Promise<string[]> {
  const out: string[] = [];
  for (const t of tools) {
    try {
      // Mirror what a live model would pass: verified SELECTs, not bare questions,
      // so mock summaries show realistic tool output (and chart_spec succeeds).
      const input = t.name === 'chart_spec'
        ? { sql: MOCK_TREND_SQL, display_type: 'LineChart', chart_name: 'Trend' }
        : t.name.includes('sql')
          ? { sql: MOCK_TREND_SQL }
          : { query, queryTimestamp: new Date().toISOString() };
      out.push(`[tool:${t.name}] ${await t.execute(input)}`);
    } catch (err) {
      out.push(`[tool:${t.name}] error: ${(err as Error).message}`);
    }
  }
  return out;
}

export class MockLlm implements LlmPort {
  async complete(opts: GenerateOptions): Promise<string> {
    const query = lastUser(opts);

    if (/respond only with json|output json|json schema/i.test(opts.system)) {
      // schedule-parse caller expects ParsedSchedule-ish JSON; extraction caller
      // expects { "facts": [] }. Disambiguate on a hint in the system prompt.
      if (/schedule/i.test(opts.system)) {
        const time = /([01]?\d|2[0-3]):([0-5]\d)/.exec(query)?.[0] ?? '08:00';
        const [h, m] = time.split(':');
        const isHourly = /hourly|every hour/i.test(query);
        return JSON.stringify({
          heading: query.slice(0, 40),
          queryText: query,
          timeOfDay: `${h!.padStart(2, '0')}:${m}`,
          recurrence: isHourly ? 'hourly' : /weekday/i.test(query) ? 'weekdays' : 'daily',
          timezone: 'Asia/Tokyo',
        });
      }
      return JSON.stringify({ facts: [] });
    }

    const toolLines = opts.tools?.length ? await runTools(opts.tools, query) : [];
    return [
      `(mock LLM answer) You asked: "${query}".`,
      ...toolLines,
      toolLines.length
        ? 'Summary: see tool output above.'
        : 'No tools were available; this is a canned response for offline mode.',
    ].join('\n');
  }

  async *stream(opts: GenerateOptions): AsyncIterable<string> {
    const full = await this.complete(opts);
    for (const word of full.split(/(\s+)/)) {
      yield word;
      await new Promise((r) => setTimeout(r, 8));
    }
  }
}
