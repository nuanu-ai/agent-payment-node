import type { CommandRequest, OutputEnvelope } from "./commands.js";
export declare function successEnvelope(request: CommandRequest, requestId: string, result: unknown): OutputEnvelope;
export declare function failureEnvelope(command: string, requestId: string, error: unknown): OutputEnvelope;
