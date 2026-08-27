import type { CommandOutcome, CommandRequest, OutputEnvelope } from "./commands.js";
export declare function successEnvelope(request: CommandRequest, requestId: string, outcome: CommandOutcome): OutputEnvelope;
export declare function failureEnvelope(command: string, requestId: string, error: unknown): OutputEnvelope;
