import type { ChainAccount, ChainAsset } from "./direct-rail-ports.js";
import { type ChainPolicy } from "./chain-policy.js";
import { SecureStateStore } from "./secure-state-store.js";
export declare class ChainPolicyStore extends SecureStateStore {
    private initialized;
    private ready;
    load(account: ChainAccount, asset: ChainAsset): Promise<ChainPolicy | null>;
    /** The caller holds the common profile lock and has obtained foreground approval. */
    write(policy: ChainPolicy): Promise<void>;
    private path;
}
