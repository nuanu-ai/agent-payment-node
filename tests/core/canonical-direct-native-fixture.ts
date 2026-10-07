import type { NativeRequest } from "../../src/ports.js";
import { StateStore } from "../../src/state.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { LocalWalletNative } from "../../src/local-wallet-native.js";
import { EvmWrappingSecret, EvmApproval } from "./evm-helpers.js";
import { TestNative as LegacyTestNative, WALLET } from "./helpers.js";

/** These lifecycle cases use the real TEST-only encrypted owner, signing journal and transaction signer.
 * Provider/RPC observations remain explicit synthetic fixtures; no user wallet or network is involved. */
export class CanonicalDirectTestNative extends LegacyTestNative {
  private readonly state: StateStore;
  private readonly wrapping = new EvmWrappingSecret();
  private readonly local: LocalWalletNative;
  constructor(root: string) {
    super();
    this.state = new StateStore(root);
    this.local = new LocalWalletNative(this.state, this.wrapping, new EvmApproval());
  }
  override async request(request: NativeRequest): Promise<unknown> {
    this.calls.push(request);
    if (this.rejectMessage !== null) throw new Error(this.rejectMessage);
    if (request.operation === "wallet.ensure") {
      await this.state.initialize();
      if (await this.state.loadEncryptedWalletEnvelope(request.payload.profile as string) === null) {
        await new EncryptedWalletStore(this.state, this.wrapping).importNew(request.payload.profile as string,
          `0x${"01".repeat(32)}`, WALLET);
      }
    }
    return this.local.request(request);
  }
}
