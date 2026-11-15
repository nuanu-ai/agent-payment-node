import { sha256 } from "../../canonical.js";
import { mmFail } from "../reasons.js";
import { readPrivateSession, selectedServerWallet } from "./private-state.js";
import { foxEvm, foxKeyring } from "./sdk-vendor.js";
import { serverTransactionAnswer, serverTransactionTx } from "./server-transaction.js";
import { hydrateSdkState } from "./session.js";
const SERVER_URL = "https://agentic-mimir-service.api.cx.metamask.io";
/**
 * Only the request's own session may send it: a session signed in to another project than `projectHash` (when the
 * request names one), or whose selected server wallet is not `tx.from`, refuses before any network call.
 */
export function assertServerTransactionSession(session, input) {
    if (input.projectHash !== null && sha256(session.projectId) !== input.projectHash)
        mmFail("mm_gasless_binding_changed");
    if (selectedServerWallet(session.walletState).address !== input.tx.from)
        mmFail("mm_gasless_binding_changed");
}
/**
 * One server-wallet transaction request with APN's own id: the SDK's low-level server adapter call `mm wallet
 * send-transaction` reaches (`EvmServerAdapter.submitTransaction(tx, { chainId, requestId, intent })`), without mm's
 * own preparation reads (APN read the nonce, fees and balances itself before consent and again in its last guard). The
 * session is read twice around the SDK's construction, as the gasless submit reads it, so a login that changed between
 * them sends nothing. The network policy admits the one POST of exactly `serverTransactionBody(input)`.
 */
export async function submitServerTransaction(input, first, home, now, policy, sent) {
    sent.stage = "sdk_load";
    const evm = await foxEvm();
    const keyrings = await foxKeyring();
    sent.stage = "hydrate";
    const hydrated = await hydrateSdkState(first);
    if (hydrated.writes() !== 0)
        mmFail("mm_gasless_state_security");
    const { keyring } = await keyrings.createKeyringController({ mode: keyrings.KEYRING_KIND.SERVER,
        input: { baseUrl: SERVER_URL, authToken: first.token, projectId: first.projectId,
            wallets: hydrated.walletState.remoteWallets }, adapters: [(deps) => new evm.EvmServerAdapter(deps)], logLevel: "silent" });
    const adapter = evm.evmServerAdapter(keyring);
    sent.stage = "binding";
    const second = await readPrivateSession(home, now());
    if (second.generationHash !== first.generationHash || second.projectId !== first.projectId || second.token !== first.token) {
        mmFail("mm_gasless_binding_changed");
    }
    assertServerTransactionSession(second, input);
    sent.stage = "post";
    const status = await adapter.submitTransaction(serverTransactionTx(input), { chainId: input.tx.chainId, origin: "apn", requestId: input.requestId, intent: input.intent });
    sent.stage = "response";
    return serverTransactionAnswer(status, input, policy.requestBodyHash(), first.session.authMethod, sent);
}
//# sourceMappingURL=server-transaction-submit.js.map