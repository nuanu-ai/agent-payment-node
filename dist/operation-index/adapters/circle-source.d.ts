import { type NonEvmSourceJournal } from "../../lifi/non-evm-source-journal.js";
import { type OperationFamilyAdapter } from "../adapter.js";
/**
 * CCTP V2 Base USDC to Solana source burns. The submit command signs only before its preparation expires, which is at
 * most CIRCLE_V2_SOURCE_TTL_MS after the journal was staged, and sends at most once in that same command. APN has no
 * observer of the source receipt for this route, so the payer is held for that window plus the unstarted margin in
 * every phase: after it, the burn either landed or its signed quote expired, and no APN path signs or sends it again.
 */
export declare const circleSourceAdapter: OperationFamilyAdapter<NonEvmSourceJournal>;
