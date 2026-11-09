#!/usr/bin/env node
// One agent loop: an OpenRouter model (for example qwen/…, deepseek/…, moonshotai/…, z-ai/…) drives APN through
// `apn serve http`. It reads the OpenRouter key and the APN bearer token from files, never from argv, and prints one
// JSON line per step: the model's tool calls, APN's envelopes, and the final answer.
//
//   OPENROUTER_API_KEY_FILE=/path/key APN_HTTP_URL=http://127.0.0.1:8402 APN_HTTP_TOKEN_FILE=/path/token \
//     node scripts/openrouter-agent.mjs --model qwen/qwen3-max --task "…" [--tools apn_wallet_status,…] [--max-steps 12]
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  model: { type: "string" }, task: { type: "string" }, tools: { type: "string" }, "max-steps": { type: "string" },
  provider: { type: "string" },
} });
const need = (value, name) => { if (value === undefined || value === "") { console.error(`missing ${name}`); process.exit(2); } return value; };
const model = need(values.model, "--model");
const task = need(values.task, "--task");
const maxSteps = Number(need(values["max-steps"] ?? "12", "--max-steps"));
const apnUrl = need(process.env.APN_HTTP_URL, "APN_HTTP_URL");
const firstLine = (path) => readFileSync(need(path, "a key file"), "utf8").split("\n")[0].trim();
const apnToken = firstLine(process.env.APN_HTTP_TOKEN_FILE);
const openRouterKey = firstLine(process.env.OPENROUTER_API_KEY_FILE);

const SYSTEM = [
  "You operate the Agent Payment Node (APN) of a company through tools. Every money action is bounded by the owner policy",
  "configured on the server; there is no human to ask. Rules:",
  "- Pass every argument as a JSON string, amounts included (\"0.01\", never 0.01).",
  "- Give each new prepare a fresh idempotency_key of 8+ characters; reuse it only to retry the same action.",
  "- Read each envelope: when ok is false, follow error.message and next_actions; never invent an operation id.",
  "- A prepare freezes the terms; approve/execute sends them. Check operation status after sending.",
  "- Stop and report when the policy or balance refuses an action; do not try to get around a refusal.",
].join("\n");

const call = async (url, init) => {
  const response = await fetch(url, init);
  const text = await response.text();
  try { return { status: response.status, body: JSON.parse(text) }; } catch { return { status: response.status, body: { raw: text.slice(0, 2000) } }; }
};

const toolsUrl = `${apnUrl}/v1/tools${values.tools === undefined ? "" : `?names=${encodeURIComponent(values.tools)}`}`;
const tools = (await call(toolsUrl, { headers: { authorization: `Bearer ${apnToken}` } })).body.tools;
if (!Array.isArray(tools) || tools.length === 0) { console.error("APN returned no tools"); process.exit(1); }
const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: task }];
const log = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);
log({ step: 0, model, tools: tools.length });

for (let step = 1; step <= maxSteps; step += 1) {
  const started = Date.now();
  const answer = await call("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${openRouterKey}`, "content-type": "application/json", "x-title": "APN server agent" },
    body: JSON.stringify({ model, messages, tools, tool_choice: "auto", temperature: 0,
      ...(values.provider === undefined ? {} : { provider: { order: values.provider.split(","), allow_fallbacks: false } }) }),
  });
  const choice = answer.body?.choices?.[0];
  if (answer.status !== 200 || choice === undefined) { log({ step, error: answer.status, body: answer.body }); process.exit(1); }
  const message = choice.message;
  messages.push({ role: "assistant", content: message.content ?? "", ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) });
  log({ step, ms: Date.now() - started, provider: answer.body.provider, usage: answer.body.usage, content: message.content,
    tool_calls: (message.tool_calls ?? []).map((tool) => ({ name: tool.function.name, arguments: tool.function.arguments })) });
  if (!message.tool_calls || message.tool_calls.length === 0) break;
  for (const toolCall of message.tool_calls) {
    const result = await call(`${apnUrl}/v1/tools/call`, {
      method: "POST", headers: { authorization: `Bearer ${apnToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: toolCall.function.name, arguments: toolCall.function.arguments }),
    });
    log({ step, tool: toolCall.function.name, status: result.status, ok: result.body.ok, error: result.body.error ?? null,
      operation: result.body.operation?.operation_id ?? result.body.operation?.id ?? null });
    messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result.body).slice(0, 12000) });
  }
}
