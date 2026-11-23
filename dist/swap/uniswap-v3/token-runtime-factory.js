import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import { approvalCode } from "../../approval-code.js";
import { ApnError } from "../../errors.js";
import { assertExclusiveUniswapTokenSigner } from "../../evm-address-ownership.js";
import { exactChainConsent } from "../../tty-approval.js";
import { UniswapTokenLaneQuoteBuilder } from "./token-builder.js";
import { UniswapTokenCustody } from "./token-custody.js";
import { SavedUniswapTokenMaterialStore } from "./token-material.js";
import { UniswapTokenJournal } from "./token-operation.js";
import { UniswapTokenObserver } from "./token-observer.js";
import { readSwapNonceConsumption, readSwapNonceUnused } from "./token-principal.js";
import { UniswapTokenSigningGuard } from "./token-guard.js";
import { UniswapTokenUsage } from "./token-usage.js";
import { InstalledUniswapTokenLaneRuntime } from "./token-runtime.js";
import { UniswapTokenRpcBudgetJournal } from "./token-rpc-budget.js";
import { tokenBatch, tokenBlock, tokenFinalizedBatchFor, tokenQuantity } from "./token-rpc.js";
import { ETHEREUM_UNISWAP_TOKEN_LANE, tokenLaneOf } from "./token-lane.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import { checkNeverLands } from "../../evm-finalized-proof.js";
/** The Ethereum token lane's runtime (canonical USDC and USDT through the original SwapRouter). */
export function createUniswapTokenRuntime(input) {
    return createUniswapTokenLaneRuntime(ETHEREUM_UNISWAP_TOKEN_LANE, input);
}
/**
 * One lane's token-input runtime over that lane's RPC: its builder, signing guard (the lane's pins unless `verifyPins`
 * replaces them), custody, observer, never-lands proof and screens. Records and quotes of the other lane refuse.
 */
export function createUniswapTokenLaneRuntime(lane, input) {
    const { state, wrapping, clock, call } = input, materials = new SavedUniswapTokenMaterialStore(state.root), custody = new UniswapTokenCustody(state, wrapping, call, () => clock.now()), observer = new UniswapTokenObserver(call), ledger = new AssetUsageLedger(state.root), usage = new UniswapTokenUsage(state, clock, ledger), guard = new UniswapTokenSigningGuard(state, wrapping, call, usage, () => clock.now(), input.verifyPins);
    const approveOwner = async (op) => await assertExclusiveUniswapTokenSigner(state, op.account, state.profileHash(op.profile));
    const ports = {
        now: () => clock.now(), withAccountLock: async (op, work) => await custody.withAccountLock(op, work),
        allocateNonce: async (op, kind) => await custody.allocateNonce(op, kind), currentAllowance: async (op, landed) => await custody.currentAllowance(op, landed),
        releaseNonce: async (op, kind, nonce) => await custody.releaseNonce(op, kind, nonce),
        commitNonce: async (op, kind, nonce) => { await custody.commitNonce(op, kind, nonce); },
        guard: async (op, kind, nonce) => await guard.inspect(op, kind, nonce), reserveUsage: async (op) => await usage.reserve(op),
        reserveSendCapacity: () => call.reserveEffectSlot?.(),
        currentUsage: async (op) => await usage.current(op), followUsage: async (op, target) => await usage.follow(op, target),
        seal: async (op, kind, nonce) => await custody.seal(op, kind, nonce),
        probeSealed: async (op, kind, nonce) => await custody.probeSealed(op, kind, nonce),
        recoverSealed: async (op, kind, nonce) => await custody.probeJournaled(op, kind, nonce),
        send: async (op, kind) => await custody.send(op, kind), observe: async (op, kind, hash) => {
            await custody.bindEffectProvider(op, kind, hash);
            return await observer.observe(op, kind, hash);
        },
        // The quote block was read before any of the swap's effects was signed; a record without one never proves never-lands.
        neverLands: async (op, kind, attempt) => {
            await custody.bindEffectProvider(op, kind, attempt.transactionHash);
            const effectLane = tokenLaneOf(op.route);
            return await checkNeverLands({ chainId: effectLane.chainId, account: op.account, nonce: BigInt(attempt.nonce), transactionHash: attempt.transactionHash,
                ...(op.quoteBlock === undefined ? {} : { before: { hash: op.quoteBlock.hash, number: BigInt(op.quoteBlock.number) } }) }, tokenFinalizedBatchFor(call, effectLane.chainDecoder));
        },
        cleanupFeeQuote: async (op) => {
            const feeLane = tokenLaneOf(op.route);
            const [chain, rawBlock, rawPriority] = await tokenBatch(call, "primary", [
                { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: feeLane.chainDecoder },
                { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "none", decoder: tokenBlock },
                { method: "eth_maxPriorityFeePerGas", params: [], cachePolicy: "none", decoder: tokenQuantity }
            ]);
            if (evmRpcQuantity(chain) !== BigInt(feeLane.chainId))
                throw new ApnError("APN_CHAIN_MISMATCH", `Uniswap token cleanup fee quote requires ${feeLane.chainLabel}.`);
            const block = evmRpcRecord(rawBlock);
            return { blockNumber: evmRpcQuantity(block.number).toString(), blockHash: evmRpcHex(block.hash, 32),
                baseFeePerGasWei: evmRpcQuantity(block.baseFeePerGas).toString(), priorityFeePerGasWei: evmRpcQuantity(rawPriority).toString() };
        },
        foregroundApprove: async (op) => { await approveOwner(op); await foreground(input.foreground === "approve", op, false, clock.now(), input.tty); await approveOwner(op); },
        foregroundCleanup: async (op) => { await approveOwner(op); await foreground(input.foreground === "cleanup", op, true, clock.now(), input.tty); await approveOwner(op); },
        swapNonceConsumed: async (op, cleanup) => await readSwapNonceConsumption(call, op, cleanup),
        swapNonceUnused: async (op, fromNonce) => await readSwapNonceUnused(call, op, fromNonce),
        confirm: async (material) => await guard.confirm(material),
    };
    const admit = async (request, now) => await usage.admitQuote(request, now);
    return new InstalledUniswapTokenLaneRuntime(lane, new UniswapTokenLaneQuoteBuilder(lane, call, materials, admit, () => clock.now(), input.verifyPins ?? lane.verifyPins), materials, new UniswapTokenJournal(state.root), ports, new UniswapTokenRpcBudgetJournal(state.root), call);
}
async function foreground(enabled, op, cleanup, now, tty = {}) {
    if (!enabled)
        throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Uniswap token approval must continue in the foreground CLI.", { reason: "swap_foreground_cli_required" });
    const lines = tokenLaneOf(op.route).screen(op, cleanup);
    await exactChainConsent(lines, approvalCode("swap", op.integrityHash, cleanup ? "cleanup" : "execute"), cleanup ? new Date(now.getTime() + 300_000).toISOString() : new Date(op.route.deadline * 1000).toISOString(), tty);
}
//# sourceMappingURL=token-runtime-factory.js.map