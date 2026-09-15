import { EncryptedSmartAccountGaslessMaterialStore } from "../encrypted-smart-account-gasless-material-store.js";
import { smartAccountGaslessObservationRpcFactory, smartAccountGaslessRpcFactory } from "./chain/rpc.js";
import { MetaMaskSmartAccountGaslessMaterial, SmartAccountGaslessMaterialValidator } from "./material.js";
import { TtySmartAccountGaslessApproval } from "./policy.js";
import { MetaMaskSmartAccountGaslessProvider } from "./provider.js";
/** Construction is lazy: no profile, file, Keychain, RPC or provider access occurs here. */
export function smartAccountGaslessRuntime(input) {
    const validator = new SmartAccountGaslessMaterialValidator(), now = () => input.clock.now();
    return {
        rpcFor: smartAccountGaslessRpcFactory(input.environment, input.clock, validator),
        observationRpcFor: smartAccountGaslessObservationRpcFactory(input.environment, input.clock, validator),
        material: new MetaMaskSmartAccountGaslessMaterial(input.permissions, new EncryptedSmartAccountGaslessMaterialStore(input.state, input.wrapping), undefined, validator, now),
        provider: new MetaMaskSmartAccountGaslessProvider(undefined, now),
        ...(input.foregroundApproval ? { approval: new TtySmartAccountGaslessApproval() } : {}),
    };
}
//# sourceMappingURL=runtime.js.map