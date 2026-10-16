/** A cached quote is handed out only while at least this much of its own 30-second window remains. */
const FEE_REUSE_MARGIN_MS = 1_000;
/** Values one live Circle command proves once (P2): the functional configuration of both chains, the attester set,
 * the issuer fee quote while its own window is open, and finalized observations, which cannot change. Failures are
 * never cached, and included or safe observations are always read fresh. */
export function circleCommandMemo(now, readDeployments, readAttesters, readFee, readObservation) {
    let deployments = null, fee = null;
    const attesters = new Map(), finalized = new Map();
    return {
        deployments: async () => deployments ??= await readDeployments(),
        attesters: async (digest) => {
            const known = attesters.get(digest);
            if (known !== undefined)
                return known;
            const value = await readAttesters(digest);
            attesters.set(digest, value);
            return value;
        },
        fee: async () => fee !== null && now() + FEE_REUSE_MARGIN_MS < fee.expiresAtMs ? fee : fee = await readFee(),
        observation: async (rpc, hash, tag) => {
            const key = `${rpc.chainId}:${hash.toLowerCase()}`, known = tag === "finalized" ? finalized.get(key) : undefined;
            if (known !== undefined)
                return known;
            const value = await readObservation(rpc, hash, tag);
            if (value !== null && tag === "finalized")
                finalized.set(key, value);
            return value;
        },
    };
}
//# sourceMappingURL=command-memo.js.map