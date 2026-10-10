import { cleanup85Blocked } from "./circle-cleanup85-native-codec.js";
import { circleHex, circleUint } from "./circle-v2-evm/protocol.js";
/** Fresh canonical headers retain the genuine opaque admission's83/84/finality and code-pin snapshots.
 * They grant no authority; the controller keeps the owner/parent/custody/policy locks and finite TTL. */
export async function reanchorCleanup85Recovery(source, destination, v) {
    const sourceAnchors = new Map();
    const add = (number, hash) => { const previous = sourceAnchors.get(number); if (previous !== undefined && previous !== hash)
        cleanup85Blocked("cached_anchor_conflict"); sourceAnchors.set(number, hash); };
    for (const p of [v.evidence.approvalProof, v.evidence.consumerProof]) {
        add(p.blockNumberAtomic, p.blockHash);
        add(p.finalityBlockNumberAtomic, p.finalityBlockHash);
    }
    add(v.deployments.source.blockNumberAtomic, v.deployments.source.blockHash);
    await Promise.all([source.identity(), destination.identity()]);
    await Promise.all([...Array.from(sourceAnchors, async ([number, hash]) => { const h = await source.block(`0x${BigInt(number).toString(16)}`); if (circleUint(h.number).toString() !== number || circleHex(h.hash, 32) !== hash)
            cleanup85Blocked("cached_source_canonical_reanchor"); }),
        (async () => { const p = v.deployments.destination, h = await destination.block(`0x${BigInt(p.blockNumberAtomic).toString(16)}`); if (circleUint(h.number).toString() !== p.blockNumberAtomic || circleHex(h.hash, 32) !== p.blockHash)
            cleanup85Blocked("cached_destination_deployment_reanchor"); })()]);
    await Promise.all([source.identity(), destination.identity()]);
}
//# sourceMappingURL=circle-cleanup85-native-reanchors.js.map