import { CircleEvmService } from "./circle-v2-evm/runtime.js";
import { SeiFundingService } from "./lifi/sei-gaszip-service.js";
import { MegaFundingService } from "./lifi/mega-gaszip-service.js";
import type { StateStore } from "./state.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { RuntimeFactoryOptions } from "./runtime-factory-options.js";

/** Construct finite funding rails while retaining their existing construction boundaries. */
export function finiteFundingRuntime(command: string, state: StateStore, wrappingSecret: WrappingSecretPort,
  options: Pick<RuntimeFactoryOptions, "seiFunding" | "megaFunding" | "circleEvm" | "cleanup85Recovery">, environment: NodeJS.ProcessEnv, now: () => number) {
  return {
    circleEvm: options.circleEvm ?? new CircleEvmService(state, wrappingSecret, environment, now, {}, undefined, options.cleanup85Recovery),
    ...(command.startsWith("sei.funding.") || options.seiFunding !== undefined
      ? { seiFunding: options.seiFunding ?? new SeiFundingService(state, wrappingSecret, environment) } : {}),
    ...(command.startsWith("mega.funding.") || options.megaFunding !== undefined
      ? { megaFunding: options.megaFunding ?? new MegaFundingService(state, wrappingSecret, environment) } : {}),
  };
}
