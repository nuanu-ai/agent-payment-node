import type { Hex } from "viem";
import type { CircleAttesterSnapshot, CircleObservation } from "./protocol.js";
import type { CircleRpc, currentCircleDeployments } from "./rpc.js";
type Deployments = Awaited<ReturnType<typeof currentCircleDeployments>>;
type Tag = "included" | "safe" | "finalized";
/** Values one live Circle command proves once (P2): the functional configuration of both chains, the attester set,
 * the issuer fee quote while its own window is open, and finalized observations, which cannot change. Failures are
 * never cached, and included or safe observations are always read fresh. */
export declare function circleCommandMemo<Fee extends {
    readonly expiresAtMs: number;
}>(now: () => number, readDeployments: () => Promise<Deployments>, readAttesters: (digest: string) => Promise<CircleAttesterSnapshot>, readFee: () => Promise<Fee>, readObservation: (rpc: CircleRpc, hash: Hex, tag: Tag) => Promise<CircleObservation | null>): {
    deployments: () => Promise<Deployments>;
    attesters: (digest: string) => Promise<CircleAttesterSnapshot>;
    fee: () => Promise<Fee>;
    observation: (rpc: CircleRpc, hash: Hex, tag: Tag) => Promise<CircleObservation | null>;
};
export {};
