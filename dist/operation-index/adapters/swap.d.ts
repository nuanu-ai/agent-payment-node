import { type SwapOperationRecord } from "../../swap/model.js";
import { type OperationFamilyAdapter } from "../adapter.js";
import type { OperationClaim } from "../types.js";
/** The account a swap signs with on its source chain (EVM, Solana or TRON). */
export declare function swapClaims(record: Pick<SwapOperationRecord, "quote">): readonly OperationClaim[];
/**
 * Guarded swaps of every lane (Uniswap, SunSwap, Jupiter, Orca, legacy Orca stable). The store is keyed by the swap
 * quote's own profile hash; the record also holds the profile under the state store's hash, so profile-wide admissions
 * see it. A swap that never wrote its submission marker cannot sign once its quote expired (`markSubmitting`).
 */
export declare const swapAdapter: OperationFamilyAdapter<SwapOperationRecord>;
