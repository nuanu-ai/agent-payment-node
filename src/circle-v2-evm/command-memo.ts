import type { Hex } from "viem";
import type { CircleAttesterSnapshot, CircleObservation } from "./protocol.js";
import type { CircleRpc, currentCircleDeployments } from "./rpc.js";

type Deployments = Awaited<ReturnType<typeof currentCircleDeployments>>;
type Tag = "included" | "safe" | "finalized";
/** A cached quote is handed out only while at least this much of its own 30-second window remains. */
const FEE_REUSE_MARGIN_MS = 1_000;

/** Values one live Circle command proves once (P2): the functional configuration of both chains, the attester set,
 * the issuer fee quote while its own window is open, and finalized observations, which cannot change. Failures are
 * never cached, and included or safe observations are always read fresh. */
export function circleCommandMemo<Fee extends { readonly expiresAtMs: number }>(now: () => number,
  readDeployments: () => Promise<Deployments>, readAttesters: (digest: string) => Promise<CircleAttesterSnapshot>,
  readFee: () => Promise<Fee>, readObservation: (rpc: CircleRpc, hash: Hex, tag: Tag) => Promise<CircleObservation | null>) {
  let deployments: Deployments | null = null, fee: Fee | null = null;
  const attesters = new Map<string, CircleAttesterSnapshot>(), finalized = new Map<string, CircleObservation>();
  return {
    deployments: async (): Promise<Deployments> => deployments ??= await readDeployments(),
    attesters: async (digest: string): Promise<CircleAttesterSnapshot> => {
      const known = attesters.get(digest); if (known !== undefined) return known;
      const value = await readAttesters(digest); attesters.set(digest, value); return value;
    },
    fee: async (): Promise<Fee> => fee !== null && now() + FEE_REUSE_MARGIN_MS < fee.expiresAtMs ? fee : fee = await readFee(),
    observation: async (rpc: CircleRpc, hash: Hex, tag: Tag): Promise<CircleObservation | null> => {
      const key = `${rpc.chainId}:${hash.toLowerCase()}`, known = tag === "finalized" ? finalized.get(key) : undefined;
      if (known !== undefined) return known;
      const value = await readObservation(rpc, hash, tag); if (value !== null && tag === "finalized") finalized.set(key, value); return value;
    },
  };
}
