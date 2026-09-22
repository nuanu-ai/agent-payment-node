import type { CommandOutcome } from "./commands.js";
export declare function dataOutcome(data: unknown, fallbackProofClass: string): CommandOutcome;
export declare function operationOutcome(operation: unknown): CommandOutcome;
export declare function receiptOutcome(receipt: unknown): CommandOutcome;
