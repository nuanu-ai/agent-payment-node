import { type EvmAssetSelection } from "./evm-asset.js";
import type { RuntimeContext } from "./runtime.js";
/** One balance path for every EVM chain. The wallet and policy are read under the profile lock; the RPC read is not. */
export declare function evmWalletBalance(context: RuntimeContext, profileInput: string, selection: EvmAssetSelection): Promise<unknown>;
