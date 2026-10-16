import { hashObject } from "../canonical.js";
import type { GaslessBlock, GaslessCursor, GaslessEffectIdentity, GaslessIntent, GaslessObservation } from "./model.js";
import { GASLESS_FINAL_PERMISSIONS_INVALIDATED, GASLESS_PERMISSIONS_INVALIDATED,
  validateGaslessPermissionInvalidation } from "./permission-invalidation.js";
import { rpcBlock, rpcFinalityBlock, sameBlock } from "./rpc-codec.js";
import type { GaslessObservationContext } from "./rpc-observe.js";
import { gaslessObservedContracts, readAccountAt } from "./rpc-state.js";

/**
 * Proves a disclosed permission can no longer be used, from current state only: the account at the current safe
 * (Polygon: finalized) head and at the latest head, read together in one request. A final seal is closed only after the
 * canonical no-event scan reached that same safe head (`scannedSafe`), so its proof block is the scan's end. The
 * contracts and protocol hash are the intent's own, so a later registry pin update cannot strand the proof.
 */
export async function observeGaslessBootstrap(context: GaslessObservationContext, intent: GaslessIntent,
  identity: GaslessEffectIdentity, cursor: GaslessCursor, scannedSafe?: GaslessBlock): Promise<GaslessObservation> {
  try {
    const final = identity.userOperationHash !== null;
    if (identity.bootstrapMaterialHash === null || final !== (identity.userOperationMaterialHash !== null) ||
      context.chainId !== intent.request.chainId || (final && scannedSafe === undefined)) throw new Error("identity");
    const [currentSafe, headBlock] = await Promise.all([
      scannedSafe === undefined ? rpcFinalityBlock(context.rpc, context.chainId).then((raw) => raw.block) : Promise.resolve(scannedSafe),
      rpcBlock(context.rpc, "latest").then((raw) => raw.block),
    ]);
    const safeBlock = final ? cursor.previousEndBlock : currentSafe;
    if (safeBlock === null || !sameBlock(safeBlock, currentSafe) ||
      (final && BigInt(cursor.nextBlockAtomic) !== BigInt(safeBlock.numberAtomic) + 1n)) throw new Error("scan");
    const contracts = gaslessObservedContracts(intent);
    const [safeAccount, headAccount] = await Promise.all([
      readAccountAt(context.rpc, contracts, intent.owner.address, safeBlock, false),
      readAccountAt(context.rpc, contracts, intent.owner.address, headBlock, true),
    ]);
    const proof = validateGaslessPermissionInvalidation(intent, identity.bootstrapMaterialHash, {
      chainId: context.chainId, intentHash: hashObject(intent), bootstrapMaterialHash: identity.bootstrapMaterialHash,
      protocolHash: intent.initialSnapshot.protocolHash, safeBlock, headBlock, safeAccount, headAccount,
      ...(final ? { userOperationMaterialHash: identity.userOperationMaterialHash!, userOperationHash: identity.userOperationHash! } : {}),
    });
    return { status: "permissions_invalidated", transactionHash: null, settlement: null, cursor,
      evidenceHash: hashObject(proof), reason: final ? GASLESS_FINAL_PERMISSIONS_INVALIDATED : GASLESS_PERMISSIONS_INVALIDATED,
      permissionInvalidation: proof };
  } catch {
    return { status: "unresolved", transactionHash: null, settlement: null, cursor,
      evidenceHash: null, reason: "gasless_bootstrap_unresolved" };
  }
}
