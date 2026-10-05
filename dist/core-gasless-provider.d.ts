import type { RuntimeContext } from "./runtime.js";
export declare function gaslessProvider(context: RuntimeContext, input: string): Promise<"local" | "metamask-agent-wallet" | "metamask-smart-account" | "coinbase-agentic-wallet">;
