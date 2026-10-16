/**
 * Gasless USDT signs on Ethereum with the owner's EOA, the shared EntryPoint and nonce key 0, exactly like the Circle rail
 * and direct sends. An execution that can still sign, send or land holds `evm:1:<sender>` for every money family; a bound
 * preparation without an execution holds nothing, because execution re-guards the exact nonces it would use. `wanted` is
 * the caller's set of conflict-domain keys (`<family>:<network>:<account>`).
 */
export declare function assertUsdtConflictDomainsAvailable(stateRoot: string, wanted: ReadonlySet<string>, exceptOperationId?: string): Promise<void>;
