import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { PRODUCT_VERSION } from "./constants.js";
import { ApnError } from "./errors.js";
import { callTool, type McpRuntimeOptions } from "./mcp-server.js";
import { serverMcpTools, type ProjectedMcpTool } from "./mcp-projection.js";
import { isServerMode } from "./server-mode.js";

export const HTTP_LISTEN_ENV = "APN_HTTP_LISTEN";
export const HTTP_TOKEN_FILE_ENV = "APN_HTTP_TOKEN_FILE";
const MAX_BODY_BYTES = 1024 * 1024;
/** Calls running at once in this process; each holds file locks and RPC budgets, so the bound protects the host. */
const MAX_CONCURRENT_CALLS = 32;

/** One tool in the OpenAI / OpenRouter `tools` format. */
export interface OpenAiTool {
  readonly type: "function";
  readonly function: { readonly name: string; readonly description: string; readonly parameters: Record<string, unknown> };
}

/**
 * The server's tools in the OpenAI function-calling shape that OpenRouter forwards to every provider. A top-level
 * `oneOf` (one command has two exclusive input forms) moves into the description, because several providers reject it.
 */
export function openAiTools(tools: readonly ProjectedMcpTool[] = serverMcpTools()): readonly OpenAiTool[] {
  return tools.map((tool) => {
    const { oneOf, ...parameters } = tool.inputSchema;
    const exclusive = oneOf === undefined ? "" : `\nInput forms (exactly one): ${JSON.stringify(oneOf)}`;
    return { type: "function", function: { name: tool.name, description: `${tool.description}${exclusive}`, parameters } };
  });
}

/**
 * `apn serve http`: the cloud entry point. It runs only in server mode, on the address `APN_HTTP_LISTEN` names
 * (`host:port`), and answers only a bearer token equal to the first line of `APN_HTTP_TOKEN_FILE`.
 *   GET  /v1/health            → { ok, version }
 *   GET  /v1/tools[?names=a,b] → { tools: OpenAiTool[] }
 *   POST /v1/tools/call        → body { name, arguments } → one apn.cli.v1 envelope
 */
export async function serveHttp(options: McpRuntimeOptions = {}): Promise<Server> {
  if (!isServerMode()) throw new ApnError("APN_INVALID_INPUT", "apn serve http runs only with APN_SERVER_MODE=1.");
  const { host, port } = listenAddress(process.env[HTTP_LISTEN_ENV]);
  const tokenDigest = await bearerDigest(process.env[HTTP_TOKEN_FILE_ENV]);
  const tools = serverMcpTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const catalog = openAiTools(tools);
  let running = 0;

  const server = createServer((request, response) => {
    void (async () => {
      if (!authorized(request, tokenDigest)) return send(response, 401, { ok: false, error: { code: "APN_HTTP_UNAUTHORIZED" } });
      const url = new URL(request.url ?? "/", "http://apn.local");
      if (request.method === "GET" && url.pathname === "/v1/health") return send(response, 200, { ok: true, version: PRODUCT_VERSION });
      if (request.method === "GET" && url.pathname === "/v1/tools") {
        const names = url.searchParams.get("names");
        const wanted = names === null ? null : new Set(names.split(",").filter((name) => name !== ""));
        return send(response, 200, { tools: wanted === null ? catalog : catalog.filter((tool) => wanted.has(tool.function.name)) });
      }
      if (request.method === "POST" && url.pathname === "/v1/tools/call") {
        if (running >= MAX_CONCURRENT_CALLS) return send(response, 503, { ok: false, error: { code: "APN_HTTP_BUSY" } });
        running += 1;
        try {
          const body = await readBody(request);
          const tool = typeof body.name === "string" ? byName.get(body.name) : undefined;
          if (tool === undefined) return send(response, 404, { ok: false, error: { code: "APN_UNSUPPORTED_COMMAND", message: "Unknown APN tool." } });
          const input = typeof body.arguments === "string" ? parseArguments(body.arguments) : body.arguments ?? {};
          return send(response, 200, await callTool(tool, input, options, true));
        } catch (error) {
          return send(response, 400, { ok: false, error: { code: error instanceof ApnError ? error.code : "APN_INVALID_INPUT",
            message: error instanceof ApnError ? error.message : "The request body must be one JSON object." } });
        } finally { running -= 1; }
      }
      return send(response, 404, { ok: false, error: { code: "APN_HTTP_NOT_FOUND" } });
    })().catch(() => { if (!response.headersSent) send(response, 500, { ok: false, error: { code: "APN_INTERNAL" } }); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); resolve(); });
  });
  process.stderr.write(`${JSON.stringify({ apn_http: { listening: `${host}:${port}`, tools: tools.length, version: PRODUCT_VERSION } })}\n`);
  return server;
}

function listenAddress(value: string | undefined): { readonly host: string; readonly port: number } {
  const match = value === undefined ? null : /^(\[[0-9a-fA-F:]+\]|[0-9.]+|[a-zA-Z0-9.-]+):([0-9]{1,5})$/u.exec(value);
  const port = match === null ? NaN : Number(match[2]);
  if (match === null || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new ApnError("APN_INVALID_INPUT", `${HTTP_LISTEN_ENV} must be host:port, for example 127.0.0.1:8402.`);
  }
  return { host: match[1]!.replace(/^\[|\]$/gu, ""), port };
}

async function bearerDigest(path: string | undefined): Promise<Buffer> {
  if (path === undefined || !path.startsWith("/")) throw new ApnError("APN_INVALID_INPUT", `${HTTP_TOKEN_FILE_ENV} must be an absolute path.`);
  const raw = await readFile(path);
  const token = raw.toString("utf8").split("\n")[0]!.trim();
  raw.fill(0);
  if (token.length < 32) throw new ApnError("APN_INVALID_INPUT", `The token in ${HTTP_TOKEN_FILE_ENV} must be at least 32 characters.`);
  return createHash("sha256").update(token).digest();
}

function authorized(request: IncomingMessage, digest: Buffer): boolean {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  return timingSafeEqual(createHash("sha256").update(header.slice(7).trim()).digest(), digest);
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new ApnError("APN_INVALID_INPUT", "The request body is too large.");
    chunks.push(chunk as Buffer);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ApnError("APN_INVALID_INPUT", "The request body must be one JSON object.");
  return value as Record<string, unknown>;
}

/** OpenAI-style tool calls carry `arguments` as a JSON string; both that and an object are accepted. */
function parseArguments(value: string): unknown {
  try { return value.trim() === "" ? {} : JSON.parse(value); }
  catch { throw new ApnError("APN_INVALID_INPUT", "Tool arguments must be one JSON object."); }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  response.end(text);
}
