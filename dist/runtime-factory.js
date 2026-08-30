import { userInfo } from "node:os";
import { resolve } from "node:path";
import { ApnCore } from "./core.js";
import { EncryptedProfilePolicy } from "./encrypted-profile-policy.js";
import { LocalWalletNative } from "./local-wallet-native.js";
import { MacOSLoginKeychainSecret } from "./macos-keychain.js";
import { TtyProfilePolicyApproval } from "./policy-approval.js";
import { HttpsBaseRpc } from "./rpc.js";
import { StateStore } from "./state.js";
import { TtyTransferApproval } from "./tty-approval.js";
import { HttpsX402Http } from "./x402-http.js";
import { AWAL_PROVIDER_ID, AwalProcessAdapter } from "./awal-process-adapter.js";
import { TtyForegroundAuthentication } from "./foreground-auth.js";
import { ProviderRegistry } from "./provider-registry.js";
import { StateProfileRepository } from "./profile-repository.js";
export function createApnCore(bound, options = {}) {
    const state = new StateStore(options.stateRoot ?? effectiveStateRoot());
    const wrappingSecret = options.wrappingSecret ?? new MacOSLoginKeychainSecret();
    const native = needsNative(bound.request.command)
        ? options.native ?? new LocalWalletNative(state, wrappingSecret, options.approval)
        : undefined;
    const policy = needsPolicy(bound.request.command)
        ? options.policy ?? new EncryptedProfilePolicy(state, wrappingSecret, options.policyApproval ?? new TtyProfilePolicyApproval(), options.clock)
        : undefined;
    const rpc = options.rpc ?? (bound.rpcUrl === undefined ? undefined : new HttpsBaseRpc(bound.rpcUrl));
    const http = options.http ?? (needsHttp(bound.request.command) ? new HttpsX402Http() : undefined);
    const profileRepository = options.profileRepository ?? new StateProfileRepository(state);
    const providerRegistry = options.providerRegistry ?? new ProviderRegistry([{
            provider_id: AWAL_PROVIDER_ID,
            create: () => new AwalProcessAdapter().bundle(),
        }]);
    const foregroundAuthentication = options.foregroundAuthentication ?? (bound.request.command === "wallet.connect" ? new TtyForegroundAuthentication() : undefined);
    const transferApproval = options.approval ?? (bound.request.command === "transfer.approve" ? new TtyTransferApproval() : undefined);
    return new ApnCore({
        state,
        profileRepository,
        providerRegistry,
        ...(foregroundAuthentication === undefined ? {} : { foregroundAuthentication }),
        ...(transferApproval === undefined ? {} : { transferApproval }),
        ...(bound.rpcUrl === undefined ? {} : { rpcUrl: bound.rpcUrl }),
        ...(native === undefined ? {} : { native }),
        ...(bound.request.command === "doctor.keychain" ? { keychainProbe: wrappingSecret } : {}),
        ...(rpc === undefined ? {} : { rpc }),
        ...(http === undefined ? {} : { http }),
        ...(policy === undefined ? {} : { policy }),
        ...(options.clock === undefined ? {} : { clock: options.clock }),
        ...(options.ids === undefined ? {} : { ids: options.ids }),
        ...(options.wait === undefined ? {} : { wait: options.wait }),
    });
}
export async function executeBoundCommand(bound, options = {}) {
    return await createApnCore(bound, options).execute(bound.request);
}
export function effectiveStateRoot() {
    return resolve(userInfo().homedir, ".apn");
}
function needsNative(command) {
    return [
        "doctor.keychain", "wallet.ensure", "wallet.status", "transfer.approve", "x402.fetch.approve", "operation.resume",
    ].includes(command);
}
function needsPolicy(command) {
    return [
        "wallet.balance", "wallet.policy.show", "wallet.policy.set", "x402.fetch.prepare",
        "x402.fetch.approve", "operation.resume",
    ].includes(command);
}
function needsHttp(command) {
    return ["x402.inspect", "x402.fetch.prepare", "x402.fetch.approve", "operation.resume"].includes(command);
}
//# sourceMappingURL=runtime-factory.js.map