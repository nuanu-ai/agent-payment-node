import { type SolanaRpcPort } from "../../solana/rpc.js";
import { type JupiterV1RawBuildResponse } from "./v1-codec.js";
import { type JupiterV1ResolvedMaterial } from "./v1-material.js";
/** Quote construction only, before any saved quote, consent, lease or signature.
 * A second official build must preserve every instruction, account, privilege,
 * lookup table and economic field. Only lifetime and timing metadata may change.
 * Execution still rereads all program bytes and uses the final frozen message.
 */
export declare function refreshJupiterV1QuoteBuild(rpc: Pick<SolanaRpcPort, "call" | "batch"> & Partial<Pick<SolanaRpcPort, "originHash">>, material: JupiterV1ResolvedMaterial, response: JupiterV1RawBuildResponse, useRpcLifetime?: boolean): Promise<JupiterV1ResolvedMaterial>;
