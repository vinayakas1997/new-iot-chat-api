/**
 * Focused assertions for the LLM JSON extraction/repair pipeline.
 * Run: npm run test:llm   (tsx, no test framework, no sqlite, no network)
 */
import { extractJson, isRepetitionLoop } from "../src/llm/parse.js";

let failures = 0;

function check(name: string, input: string, expectStage: string | null, expectValue?: unknown) {
  const got = extractJson(input);
  const stage = got?.stage ?? null;
  const stageOk = expectStage == null ? got == null : stage === expectStage || (expectStage.endsWith("*") && stage != null && stage.startsWith(expectStage.slice(0, -1)));
  let valueOk = true;
  if (got != null && expectValue !== undefined) {
    valueOk = JSON.stringify(got.value) === JSON.stringify(expectValue);
  }
  if (!stageOk || !valueOk) {
    failures++;
    console.error(`FAIL ${name}: stage=${stage} value=${JSON.stringify(got?.value)?.slice(0, 120)}`);
  } else {
    console.log(`ok   ${name} [${stage}]`);
  }
}

// strict
check("strict object", `{"a":1}`, "strict", { a: 1 });
check("strict array", `[1,2]`, "strict", [1, 2]);
// fences (recovered by the strict-stage extractor — dedicated stage is backup)
check("fenced json", "```json\n{\"a\":1}\n```", "strict+extract", { a: 1 });
check("fenced bare", "```\n{\"a\":1}\n```", "strict+extract", { a: 1 });
check("fenced truncated", "```json\n{\"a\":1", "repair-truncated+extract", { a: 1 });
// prose around JSON
check("prose prefix", `Here you go: {"a":1}`, "strict+extract", { a: 1 });
check("prose suffix", `{"a":1} hope this helps`, "strict+extract", { a: 1 });
// trailing commas (recovered by the strict-stage extractor+repair)
check("trailing comma obj", `{"a":1,}`, "strict+extract+repair", { a: 1 });
check("trailing comma arr", `{"a":[1,2,]}`, "strict+extract+repair", { a: [1, 2] });
// truncation (finish_reason: length)
check("truncated object", `{"candidates":[{"chartType":"line","xColumn":"t"`, "repair-truncated*", {
  candidates: [{ chartType: "line", xColumn: "t" }],
});
check("truncated string", `{"title":"temp over`, "repair-truncated*", { title: "temp over" });
check("truncated array", `{"y":["a","b"`, "repair-truncated*", { y: ["a", "b"] });
// hopeless
check("empty", ``, null);
check("whitespace", `   `, null);
check("no json", `hello world`, null);
check("unbalanced close", `{"a":1}}`, null);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall parse checks passed");

// --- repetition-loop detector ---
let loopFailures = 0;
function checkLoop(name: string, input: string, expected: boolean) {
  const got = isRepetitionLoop(input);
  if (got !== expected) {
    loopFailures++;
    console.error(`FAIL loop/${name}: got ${got}, want ${expected}`);
  } else {
    console.log(`ok   loop/${name} [${got}]`);
  }
}

const looped = `{\n${'  "Candidates": 1,\n'.repeat(200)}  "Candidates":`;
checkLoop("real qwen loop", looped, true);
checkLoop("short repeat", `"a": 1,\n"a": 1,\n"a": 1,`, false);
checkLoop(
  "valid pretty candidates",
  JSON.stringify({ candidates: [1, 2, 3, 4].map((i) => ({ chartType: "line", xColumn: "t", yColumns: [`y${i}`], title: `t${i}` })) }, null, 1),
  false
);
checkLoop("empty", "", false);

if (loopFailures > 0) {
  console.error(`\n${loopFailures} loop failure(s)`);
  process.exit(1);
}
console.log("all loop checks passed");
