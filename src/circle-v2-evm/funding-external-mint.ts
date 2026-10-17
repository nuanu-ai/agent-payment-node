import type { Address, Hex } from "viem";
import { ApnError } from "../errors.js";
import { CIRCLE_TRANSMITTER, circleRoute, type CircleDestinationChain } from "./catalog.js";
import { discoverCircleExternalMint, type CircleDiscoveryRpc } from "./external-discovery.js";
import { circleBlocked, circleCorrupt } from "./operation-model.js";
import { circleHex, circleUint } from "./protocol.js";
import type { CircleRpc } from "./rpc.js";
import type { CircleFundingOperationV2 } from "./funding-operation.js";

/** What a command learned about a mint someone else relayed for this burn. `found` is internal: the command adopts it
 * (`adopted`) or keeps it for the next observation while the destination SAFE head has not reached it. */
export interface CircleExternalMintNotice {
  readonly status: "awaiting_source_finality" | "found" | "found_awaiting_finality" | "not_found" | "adopted";
  readonly destination_chain: CircleDestinationChain; readonly transmitter: Address; readonly message_nonce: Hex; readonly transaction_hash: Hex | null;
  readonly scan: { readonly from_block: string; readonly to_block: string; readonly head_block: string; readonly log_window_blocks: number;
    readonly log_requests: number; readonly header_requests: number } | null;
}
export interface CircleFundingCommandResult { readonly operation: CircleFundingOperationV2; readonly externalMint: CircleExternalMintNotice | null; }

/** The issuer message of `op` is used on the destination and no owned mint can land. Adoption proves the burn at the source
 * FINALIZED head, so nothing is scanned before that; then the burn block's own header gives the scan its start time. */
export async function findCircleFundingExternalMint(op: CircleFundingOperationV2, source: Pick<CircleRpc, "block">, destination: () => CircleDiscoveryRpc): Promise<CircleExternalMintNotice> {
  if (op.source === null || op.attestation === null) circleCorrupt("external_mint_without_source");
  const base = { destination_chain: op.destinationChain, transmitter: CIRCLE_TRANSMITTER, message_nonce: op.attestation.nonce };
  if (op.source.finalityTag !== "finalized") return { status: "awaiting_source_finality", ...base, transaction_hash: null, scan: null };
  const header = await source.block(`0x${BigInt(op.source.blockNumberAtomic).toString(16)}`);
  if (circleHex(header.hash, 32) !== op.source.blockHash) circleBlocked("source_reorg_holds_required");
  const scan = await discoverCircleExternalMint(destination(), op.attestation.nonce, circleUint(header.timestamp));
  return { status: scan.transactionHash === null ? "not_found" : "found", ...base, transaction_hash: scan.transactionHash,
    scan: { from_block: scan.fromBlock.toString(), to_block: scan.toBlock.toString(), head_block: scan.headBlock.toString(), log_window_blocks: circleRoute(op.destinationChain).logRange,
      log_requests: scan.logReads, header_requests: scan.headerReads } };
}

/** A found external mint is adopted once the command's locks are released, through the same path as
 * `adopt-external-mint` (no signing, no consent). One the destination SAFE head has not reached yet stays found. */
export async function settleCircleFundingExternalMint(op: CircleFundingOperationV2, notice: CircleExternalMintNotice | null,
  adopt: (transactionHash: Hex) => Promise<CircleFundingOperationV2>): Promise<CircleFundingCommandResult> {
  if (notice === null || notice.status !== "found" || notice.transaction_hash === null) return { operation: op, externalMint: notice };
  try { return { operation: await adopt(notice.transaction_hash), externalMint: { ...notice, status: "adopted" } }; }
  catch (error) {
    if (error instanceof ApnError && error.details?.reason === "external_finality_unresolved") return { operation: op, externalMint: { ...notice, status: "found_awaiting_finality" } };
    throw error;
  }
}
