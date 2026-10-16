import { type WrappingSecretPort } from "../macos-keychain.js";
import type { ClockPort } from "../ports.js";
import { StateStore } from "../state.js";
import { type RelayAbandonConsentPort } from "./retire-source.js";
export { TtyRelayAbandonConfirmation } from "./retire-source.js";
export declare class RelayRetireService {
    private readonly state;
    private readonly clock;
    private readonly wrapping;
    /** Required only to abandon a route after its confirmed approval; without it that case is refused. */
    private readonly abandon?;
    constructor(state: StateStore, clock: ClockPort, wrapping?: WrappingSecretPort, 
    /** Required only to abandon a route after its confirmed approval; without it that case is refused. */
    abandon?: RelayAbandonConsentPort | undefined);
    /** Any profile retires its own operations: the operation is found only under `profileHash(profile)` (other profiles'
     * operations are invisible), and the owner lock is taken on the operation's own recorded source account (OWNR-08). */
    retire(input: {
        readonly profile: string;
        readonly operationId: string;
    }): Promise<import("../relay-unsigned-operation.js").PublicRelayUnsignedOperation>;
    private abandonConsent;
    /** Ethereum and Arbitrum token lanes. The principal hold is released only after the source state is re-proven. */
    private retireTokenLane;
}
