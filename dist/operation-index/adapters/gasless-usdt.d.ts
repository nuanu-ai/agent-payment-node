import { type UsdtExecutionRecord } from "../../gasless-usdt/execution-journal.js";
import { type OperationFamilyAdapter } from "../adapter.js";
/** Gasless USDT signs on Ethereum with the owner's EOA, the shared EntryPoint and nonce key 0. */
export declare const GASLESS_USDT_CHAIN_ID = 1;
/**
 * Gasless USDT executions. A bound preparation holds nothing (execution re-guards the exact nonces it uses); an
 * execution is admitted before its first RPC read or signature and holds the sender while it can still sign, send or land.
 * Its profile hash is the allowlist overlay's, as the execution journal stores it.
 */
export declare const gaslessUsdtAdapter: OperationFamilyAdapter<UsdtExecutionRecord>;
