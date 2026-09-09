import type { MetaMaskGaslessClock } from "./clock.js";
import type { MetaMaskGaslessBinding, MetaMaskGaslessQuote, MetaMaskGaslessRequest } from "./model.js";
import type { MetaMaskGaslessProviderPort } from "./ports.js";
export declare function metaMaskGaslessQuote(provider: MetaMaskGaslessProviderPort, binding: MetaMaskGaslessBinding, request: MetaMaskGaslessRequest, rpcUrl: string, clock: MetaMaskGaslessClock): Promise<MetaMaskGaslessQuote>;
