import { EncryptedSmartAccountGaslessMaterialStore } from "../encrypted-smart-account-gasless-material-store.js";
import type { SmartAccountPermissionStorePort } from "../encrypted-smart-account-permission-store.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { ClockPort } from "../ports.js";
import type { StateStore } from "../state.js";
import { smartAccountGaslessObservationRpcFactory, smartAccountGaslessRpcFactory } from "./chain/rpc.js";
import { MetaMaskSmartAccountGaslessMaterial, SmartAccountGaslessMaterialValidator } from "./material.js";
import { TtySmartAccountGaslessApproval } from "./policy.js";
import { MetaMaskSmartAccountGaslessProvider } from "./provider.js";
import type { SmartAccountGaslessDependencies } from "./service.js";

/** Construction is lazy: no profile, file, Keychain, RPC or provider access occurs here. */
export function smartAccountGaslessRuntime(input: { readonly state: StateStore;
  readonly permissions: SmartAccountPermissionStorePort; readonly wrapping: WrappingSecretPort;
  readonly clock: ClockPort; readonly environment: Readonly<Record<string, string | undefined>>;
  readonly foregroundApproval: boolean }): SmartAccountGaslessDependencies {
  const validator = new SmartAccountGaslessMaterialValidator(), now = () => input.clock.now();
  return {
    rpcFor: smartAccountGaslessRpcFactory(input.environment, input.clock, validator),
    observationRpcFor: smartAccountGaslessObservationRpcFactory(input.environment, input.clock, validator),
    material: new MetaMaskSmartAccountGaslessMaterial(input.permissions,
      new EncryptedSmartAccountGaslessMaterialStore(input.state, input.wrapping), undefined, validator, now),
    provider: new MetaMaskSmartAccountGaslessProvider(undefined, now),
    ...(input.foregroundApproval ? { approval: new TtySmartAccountGaslessApproval() } : {}),
  };
}
