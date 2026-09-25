import { type WrappingSecretPort } from "../macos-keychain.js";
import type { ClockPort } from "../ports.js";
import { StateStore } from "../state.js";
export declare class RelayRetireService {
    private readonly state;
    private readonly clock;
    private readonly wrapping;
    constructor(state: StateStore, clock: ClockPort, wrapping?: WrappingSecretPort);
    retire(input: {
        readonly profile: string;
        readonly operationId: string;
    }): Promise<import("../relay-unsigned-operation.js").PublicRelayUnsignedOperation>;
}
