import { ApnError } from "../errors.js";
import { USDT_EXECUTION_OPEN_STATES, UsdtExecutionJournal } from "./execution-journal.js";
import { USDT_GASLESS } from "./model.js";
/**
 * Gasless USDT signs on Ethereum with the owner's EOA, the shared EntryPoint and nonce key 0, exactly like the Circle rail
 * and direct sends. An execution that can still sign, send or land holds `evm:1:<sender>` for every money family; a bound
 * preparation without an execution holds nothing, because execution re-guards the exact nonces it would use. `wanted` is
 * the caller's set of conflict-domain keys (`<family>:<network>:<account>`).
 */
export async function assertUsdtConflictDomainsAvailable(stateRoot, wanted, exceptOperationId) {
    const network = `evm:${USDT_GASLESS.chainId}:`;
    if (![...wanted].some(key => key.startsWith(network)))
        return;
    for (const record of await new UsdtExecutionJournal(stateRoot).listAll()) {
        const domain = `${network}${record.sender.toLowerCase()}`;
        if (record.operationId === exceptOperationId || !USDT_EXECUTION_OPEN_STATES.includes(record.state) || !wanted.has(domain))
            continue;
        throw new ApnError("APN_OPERATION_BLOCKED", "Another money operation for this network and account is not terminal.", {
            blockingOperationId: record.operationId, blockingState: record.state,
            blockingNetwork: `evm:${USDT_GASLESS.chainId}`, blockingAccount: record.sender.toLowerCase(),
        });
    }
}
//# sourceMappingURL=account-conflict.js.map