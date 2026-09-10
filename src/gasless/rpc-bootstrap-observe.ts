import { hashObject } from "../canonical.js";
import type { GaslessCursor, GaslessEffectIdentity, GaslessIntent, GaslessObservation } from "./model.js";
import { GASLESS_PERMISSIONS_INVALIDATED, validateGaslessPermissionInvalidation } from "./permission-invalidation.js";
import { recheckBlock, rpcBlock } from "./rpc-codec.js";
import type { GaslessObservationContext } from "./rpc-observe.js";
import { readAccountAt, verifyProtocolAt } from "./rpc-state.js";
import { gaslessProtocolHash } from "./registry.js";

export async function observeGaslessBootstrap(context: GaslessObservationContext, intent: GaslessIntent,
  identity: GaslessEffectIdentity, cursor: GaslessCursor): Promise<GaslessObservation> {
  try {
    if (identity.bootstrapMaterialHash === null || identity.userOperationMaterialHash !== null ||
      identity.userOperationHash !== null || context.chainId !== intent.request.chainId ||
      gaslessProtocolHash(context.deployment) !== intent.initialSnapshot.protocolHash) throw new Error("identity");
    await recheckBlock(context.rpc, intent.initialSnapshot.block);
    const safeBlock = (await rpcBlock(context.rpc, "safe")).block;
    const headBlock = (await rpcBlock(context.rpc, "latest")).block;
    await verifyProtocolAt(context.rpc, context.deployment, safeBlock);
    const safeAccount = await readAccountAt(context.rpc, context.deployment, intent.owner.address, safeBlock, false);
    await verifyProtocolAt(context.rpc, context.deployment, headBlock);
    const headAccount = await readAccountAt(context.rpc, context.deployment, intent.owner.address, headBlock, true);
    await recheckBlock(context.rpc, intent.initialSnapshot.block);
    await recheckBlock(context.rpc, safeBlock); await recheckBlock(context.rpc, headBlock);
    const proof = validateGaslessPermissionInvalidation(intent, identity.bootstrapMaterialHash, {
      chainId: context.chainId, intentHash: hashObject(intent), bootstrapMaterialHash: identity.bootstrapMaterialHash,
      protocolHash: gaslessProtocolHash(context.deployment), safeBlock, headBlock, safeAccount, headAccount,
    });
    return { status: "permissions_invalidated", transactionHash: null, settlement: null, cursor,
      evidenceHash: hashObject(proof), reason: GASLESS_PERMISSIONS_INVALIDATED, permissionInvalidation: proof };
  } catch {
    return { status: "unresolved", transactionHash: null, settlement: null, cursor,
      evidenceHash: null, reason: "gasless_bootstrap_unresolved" };
  }
}
