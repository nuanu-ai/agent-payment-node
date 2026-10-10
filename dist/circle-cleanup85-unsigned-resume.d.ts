import type { CircleOperationV1 } from "./circle-v2-evm/operation-model.js";
import type { StateStore } from "./state.js";
/** No dispatch authority: the only exclusion is derived from this root's retained finite intent.
 * Called with the enclosing profile/address/operation and policy locks held. */
export declare function cleanup85UnsignedResumeExclusion(state: StateStore, parent: CircleOperationV1, now: number): Promise<string | null>;
