import { CircleFundingEvmService } from "./circle-v2-evm/funding-runtime.js";
import { GaszipFundingService } from "./lifi/gaszip-direct-service.js";
import { GASZIP_DIRECT_ROUTES } from "./lifi/gaszip-direct-route.js";
import type { StateStore } from "./state.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { RuntimeFactoryOptions } from "./runtime-factory-options.js";

/** Construct finite funding rails while retaining their existing construction boundaries. */
export function finiteFundingRuntime(command: string, state: StateStore, wrappingSecret: WrappingSecretPort,
  options: Pick<RuntimeFactoryOptions, "seiFunding" | "megaFunding" | "circleFundingEvm">, environment: NodeJS.ProcessEnv, now: () => number) {
  return {
    circleFundingEvm: options.circleFundingEvm ?? new CircleFundingEvmService(state, wrappingSecret, environment, now),
    ...(command.startsWith("sei.funding.") || options.seiFunding !== undefined
      ? { seiFunding: options.seiFunding ?? new GaszipFundingService(GASZIP_DIRECT_ROUTES.sei, state, wrappingSecret, environment) } : {}),
    ...(command.startsWith("mega.funding.") || options.megaFunding !== undefined
      ? { megaFunding: options.megaFunding ?? new GaszipFundingService(GASZIP_DIRECT_ROUTES.mega, state, wrappingSecret, environment) } : {}),
  };
}
