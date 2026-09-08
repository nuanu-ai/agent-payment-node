import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import type { BridgeOwner } from "./model.js";
import type { BridgeOperationRecord } from "./operation-model.js";
import type { BridgeCustodyPort, BridgeSealedMaterial } from "./ports.js";
export declare class LocalBridgeCustody implements BridgeCustodyPort {
    private readonly state;
    private readonly now;
    private readonly wallets;
    private readonly effects;
    constructor(state: StateStore, wrapping: WrappingSecretPort, now?: () => number);
    load(op: BridgeOperationRecord, role: "approval" | "bridge"): Promise<BridgeSealedMaterial | null>;
    seal(op: BridgeOperationRecord, role: "approval" | "bridge", owner: BridgeOwner): Promise<BridgeSealedMaterial>;
}
