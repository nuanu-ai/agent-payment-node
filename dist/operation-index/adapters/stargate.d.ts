import type { StargateNativeOperation } from "../../stargate-v2/native-execution.js";
import type { StargateTokenOperation } from "../../stargate-v2/token-model.js";
import { type LegacyStargateRecord } from "../../legacy/stargate-v2/reader.js";
import { type OperationFamilyAdapter } from "../adapter.js";
/** Native ETH from Ethereum (chain 1) and token USDC from Optimism (chain 10); the record's own envelope names the chain. */
export declare const STARGATE_NATIVE_SOURCE_CHAIN = 1, STARGATE_TOKEN_SOURCE_CHAIN_ID = 10;
/** Execute refuses an expired `prepared` or `approved` journal before signing; once a hash is recorded it is observed to the end. */
export declare const stargateNativeAdapter: OperationFamilyAdapter<StargateNativeOperation | LegacyStargateRecord>;
/** Neither an approval nor a send is signed past the prepare expiry; any signed approval, send or cleanup ends observed or cleaned. */
export declare const stargateTokenAdapter: OperationFamilyAdapter<StargateTokenOperation | LegacyStargateRecord>;
