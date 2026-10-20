import { type X402SolanaRecord } from "./model.js";
/**
 * The owner's exit for an exposed payment no proof decides yet (R4): after TTY consent it ends `abandoned_unknown` and the
 * price stays charged. A payment never exposed has proven exits instead (`x402 solana observe` once its window passes).
 */
export declare function abandonX402Solana(root: string, operationId: string, now: () => Date, approve: (record: X402SolanaRecord) => Promise<void>): Promise<X402SolanaRecord>;
