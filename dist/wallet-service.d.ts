import type { RuntimeContext } from "./runtime.js";
import type { CommandRequest } from "./commands.js";
import type { Address } from "./model.js";
export declare class WalletService {
    private readonly context;
    constructor(context: RuntimeContext);
    /**
     * An unreadable Keychain fails from `load` (APN_NATIVE_REJECTED, nativeCode APN_KEYCHAIN_UNAVAILABLE). A readable one
     * answers: without a wallet the answer is reported as `wrapping_secret`, and a missing one is followed by a first
     * `wallet ensure` only while nothing sealed exists (else the restore step); with a wallet a missing secret is refused
     * with reason `wrapping_secret_missing`, and a present one must also decrypt the wallet.
     */
    doctorKeychain(profileInput: string): Promise<unknown>;
    ensure(profileInput: string): Promise<unknown>;
    importNew(profileInput: string, keyFile: string, keyName: string, expectedAddress: string): Promise<unknown>;
    /**
     * `wallet ensure` of an incomplete wallet (incompleteWallet): an earlier ensure or import sealed its key and stopped
     * before the public record. Native custody decrypts that envelope and derives its address from the sealed key; the
     * public record and the local profile are then written exactly as a first ensure writes them, under its locks (this
     * profile's, the custody lock inside native, the address lock for the record). No key is created. A different
     * provider profile was refused by the caller, and a local one must already equal this wallet's projection.
     */
    private complete;
    private materializeLocalProfile;
    status(profileInput: string): Promise<unknown>;
    /** Public identity plus, through native describe, proof that the wrapping secret is still in the Keychain. */
    private initializedStatus;
    balance(profileInput: string): Promise<unknown>;
    policyShow(profileInput: string, chainId?: number, asset?: Address, solanaMint?: string): Promise<unknown>;
    policySet(request: Extract<CommandRequest, {
        readonly command: "wallet.policy.set";
    }>): Promise<unknown>;
    private policyBindingForProfile;
}
