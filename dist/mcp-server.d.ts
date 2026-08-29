import { Server } from "@modelcontextprotocol/server";
import { type RuntimeFactoryOptions } from "./runtime-factory.js";
export type McpRuntimeOptions = Omit<RuntimeFactoryOptions, "policy" | "policyApproval">;
export declare function createMcpServer(options?: McpRuntimeOptions): Server;
export declare function serveMcpStdio(): Promise<void>;
