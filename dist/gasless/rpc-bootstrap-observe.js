import { hashObject } from "../canonical.js";
import { GASLESS_FINAL_PERMISSIONS_INVALIDATED, GASLESS_PERMISSIONS_INVALIDATED, validateGaslessPermissionInvalidation } from "./permission-invalidation.js";
import { recheckBlock, rpcBlock, rpcFinalityBlock, sameBlock } from "./rpc-codec.js";
import { readAccountAt, verifyProtocolAt } from "./rpc-state.js";
import { gaslessProtocolHash } from "./registry.js";
export async function observeGaslessBootstrap(context, intent, identity, cursor) {
    try {
        const final = identity.userOperationHash !== null;
        if (identity.bootstrapMaterialHash === null || final !== (identity.userOperationMaterialHash !== null) ||
            context.chainId !== intent.request.chainId ||
            gaslessProtocolHash(context.deployment) !== intent.initialSnapshot.protocolHash)
            throw new Error("identity");
        await recheckBlock(context.rpc, intent.initialSnapshot.block);
        const currentSafe = (await rpcFinalityBlock(context.rpc, context.chainId)).block;
        // A final seal additionally requires the canonical no-event scan through this block.
        const safeBlock = final ? cursor.previousEndBlock : currentSafe;
        if (safeBlock === null || BigInt(safeBlock.numberAtomic) > BigInt(currentSafe.numberAtomic) ||
            (safeBlock.numberAtomic === currentSafe.numberAtomic && !sameBlock(safeBlock, currentSafe)) ||
            (final && BigInt(cursor.nextBlockAtomic) !== BigInt(safeBlock.numberAtomic) + 1n))
            throw new Error("scan");
        const headBlock = (await rpcBlock(context.rpc, "latest")).block;
        await verifyProtocolAt(context.rpc, context.deployment, safeBlock);
        const safeAccount = await readAccountAt(context.rpc, context.deployment, intent.owner.address, safeBlock, false);
        await verifyProtocolAt(context.rpc, context.deployment, headBlock);
        const headAccount = await readAccountAt(context.rpc, context.deployment, intent.owner.address, headBlock, true);
        await recheckBlock(context.rpc, intent.initialSnapshot.block);
        await recheckBlock(context.rpc, safeBlock);
        await recheckBlock(context.rpc, headBlock);
        await recheckBlock(context.rpc, currentSafe);
        const proof = validateGaslessPermissionInvalidation(intent, identity.bootstrapMaterialHash, {
            chainId: context.chainId, intentHash: hashObject(intent), bootstrapMaterialHash: identity.bootstrapMaterialHash,
            protocolHash: gaslessProtocolHash(context.deployment), safeBlock, headBlock, safeAccount, headAccount,
            ...(final ? { userOperationMaterialHash: identity.userOperationMaterialHash, userOperationHash: identity.userOperationHash } : {}),
        });
        return { status: "permissions_invalidated", transactionHash: null, settlement: null, cursor,
            evidenceHash: hashObject(proof), reason: final ? GASLESS_FINAL_PERMISSIONS_INVALIDATED : GASLESS_PERMISSIONS_INVALIDATED,
            permissionInvalidation: proof };
    }
    catch {
        return { status: "unresolved", transactionHash: null, settlement: null, cursor,
            evidenceHash: null, reason: "gasless_bootstrap_unresolved" };
    }
}
//# sourceMappingURL=rpc-bootstrap-observe.js.map