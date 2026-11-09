import { type Server } from "node:http";
import { type McpRuntimeOptions } from "./mcp-server.js";
import { type ProjectedMcpTool } from "./mcp-projection.js";
export declare const HTTP_LISTEN_ENV = "APN_HTTP_LISTEN";
export declare const HTTP_TOKEN_FILE_ENV = "APN_HTTP_TOKEN_FILE";
/** One tool in the OpenAI / OpenRouter `tools` format. */
export interface OpenAiTool {
    readonly type: "function";
    readonly function: {
        readonly name: string;
        readonly description: string;
        readonly parameters: Record<string, unknown>;
    };
}
/**
 * The server's tools in the OpenAI function-calling shape that OpenRouter forwards to every provider. A top-level
 * `oneOf` (one command has two exclusive input forms) moves into the description, because several providers reject it.
 */
export declare function openAiTools(tools?: readonly ProjectedMcpTool[]): readonly OpenAiTool[];
/**
 * `apn serve http`: the cloud entry point. It runs only in server mode, on the address `APN_HTTP_LISTEN` names
 * (`host:port`), and answers only a bearer token equal to the first line of `APN_HTTP_TOKEN_FILE`.
 *   GET  /v1/health            → { ok, version }
 *   GET  /v1/tools[?names=a,b] → { tools: OpenAiTool[] }
 *   POST /v1/tools/call        → body { name, arguments } → one apn.cli.v1 envelope
 */
export declare function serveHttp(options?: McpRuntimeOptions): Promise<Server>;
