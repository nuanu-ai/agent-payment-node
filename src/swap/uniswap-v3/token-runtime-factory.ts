import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import { approvalCode } from "../../approval-code.js";
import { ApnError } from "../../errors.js";
import { assertExclusiveUniswapTokenSigner } from "../../evm-address-ownership.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import type { ClockPort } from "../../ports.js";
import type { StateStore } from "../../state.js";
import { exactChainConsent } from "../../tty-approval.js";
import type { TtyTransferApprovalOptions } from "../../tty-approval.js";
import { UniswapTokenQuoteBuilder } from "./token-builder.js";
import { UniswapTokenCustody } from "./token-custody.js";
import type { UniswapTokenCommandRuntime, UniswapTokenExecutionPorts } from "./token-execution.js";
import { SavedUniswapTokenMaterialStore } from "./token-material.js";
import { UniswapTokenJournal, type UniswapTokenOperation } from "./token-operation.js";
import { UniswapTokenObserver } from "./token-observer.js";
import { readSwapNonceConsumption } from "./token-principal.js";
import { UniswapTokenSigningGuard } from "./token-guard.js";
import { UniswapTokenUsage } from "./token-usage.js";
import { InstalledUniswapTokenRuntime } from "./token-runtime.js";
import { UniswapTokenRpcBudgetJournal } from "./token-rpc-budget.js";
import { tokenBatch, tokenBlock, tokenChain, tokenFinalizedBatch, tokenQuantity, type TokenRpcCall } from "./token-rpc.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import { checkNeverLands } from "../../evm-finalized-proof.js";

export function createUniswapTokenRuntime(input: { readonly state: StateStore; readonly wrapping: WrappingSecretPort;
  readonly clock: ClockPort; readonly call: EvmRpcCall; readonly foreground: "approve" | "cleanup" | "refuse";
  readonly tty?: TtyTransferApprovalOptions; readonly verifyPins?: (call: EvmRpcCall, tag: import("viem").Hex) => Promise<void> }): UniswapTokenCommandRuntime {
  const { state, wrapping, clock, call } = input, materials = new SavedUniswapTokenMaterialStore(state.root), custody = new UniswapTokenCustody(state, wrapping, call, () => clock.now()),
    observer = new UniswapTokenObserver(call), ledger = new AssetUsageLedger(state.root),
    usage = new UniswapTokenUsage(state, clock, ledger), guard = new UniswapTokenSigningGuard(state, wrapping, call, usage, () => clock.now(), input.verifyPins);
  const approveOwner = async (op: UniswapTokenOperation) =>
    await assertExclusiveUniswapTokenSigner(state, op.account, state.profileHash(op.profile));
  const ports: UniswapTokenExecutionPorts & { confirm(material: import("./token-material.js").UniswapTokenMaterial): Promise<void> } = {
    now: () => clock.now(), withAccountLock: async (op, work) => await custody.withAccountLock(op, work),
    allocateNonce: async (op, kind) => await custody.allocateNonce(op, kind), currentAllowance: async (op) => await custody.currentAllowance(op),
    releaseNonce: async (op, kind, nonce) => await custody.releaseNonce(op, kind, nonce),
    commitNonce: async (op, kind, nonce) => { await custody.commitNonce(op, kind, nonce); },
    guard: async (op, kind, nonce) => await guard.inspect(op, kind, nonce), reserveUsage: async (op) => await usage.reserve(op),
    reserveSendCapacity: () => (call as TokenRpcCall).reserveEffectSlot?.(),
    currentUsage: async (op) => await usage.current(op), followUsage: async (op, target) => await usage.follow(op, target),
    seal: async (op, kind, nonce) => await custody.seal(op, kind, nonce),
    probeSealed: async (op, kind, nonce) => await custody.probeSealed(op, kind, nonce),
    recoverSealed: async (op, kind, nonce) => await custody.probeJournaled(op, kind, nonce),
    send: async (op, kind) => await custody.send(op, kind), observe: async (op, kind, hash) => {
      await custody.bindEffectProvider(op, kind, hash); return await observer.observe(op, kind, hash); },
    // The quote block was read before any of the swap's effects was signed; a record without one never proves never-lands.
    neverLands: async (op, kind, attempt) => { await custody.bindEffectProvider(op, kind, attempt.transactionHash!);
      return await checkNeverLands({ chainId: 1, account: op.account, nonce: BigInt(attempt.nonce), transactionHash: attempt.transactionHash!,
        ...(op.quoteBlock === undefined ? {} : { before: { hash: op.quoteBlock.hash, number: BigInt(op.quoteBlock.number) } }) },
        tokenFinalizedBatch(call as TokenRpcCall)); },
    cleanupFeeQuote: async () => {
      const [chain, rawBlock, rawPriority] = await tokenBatch(call as TokenRpcCall, "primary", [
        { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: tokenChain },
        { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "none", decoder: tokenBlock },
        { method: "eth_maxPriorityFeePerGas", params: [], cachePolicy: "none", decoder: tokenQuantity }]);
      if (evmRpcQuantity(chain) !== 1n) throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap token cleanup fee quote requires Ethereum chain 1.");
      const block = evmRpcRecord(rawBlock);
      return { blockNumber: evmRpcQuantity(block.number).toString(), blockHash: evmRpcHex(block.hash, 32),
        baseFeePerGasWei: evmRpcQuantity(block.baseFeePerGas).toString(), priorityFeePerGasWei: evmRpcQuantity(rawPriority).toString() };
    },
    foregroundApprove: async (op) => { await approveOwner(op); await foreground(input.foreground === "approve", op, false, clock.now(), input.tty); await approveOwner(op); },
    foregroundCleanup: async (op) => { await approveOwner(op); await foreground(input.foreground === "cleanup", op, true, clock.now(), input.tty); await approveOwner(op); },
    swapNonceConsumed: async (op, cleanup) => await readSwapNonceConsumption(call as TokenRpcCall, op, cleanup),
    confirm: async (material) => await guard.confirm(material),
  };
  const admit = async (request: Parameters<UniswapTokenQuoteBuilder["quote"]>[0], now: Date) => await usage.admitQuote(request, now);
  return new InstalledUniswapTokenRuntime(new UniswapTokenQuoteBuilder(call, materials, admit, () => clock.now(), input.verifyPins), materials,
    new UniswapTokenJournal(state.root), ports, new UniswapTokenRpcBudgetJournal(state.root), call as TokenRpcCall);
}
async function foreground(enabled: boolean, op: UniswapTokenOperation, cleanup: boolean, now: Date, tty: TtyTransferApprovalOptions = {}) {
  if (!enabled) throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Uniswap token approval must continue in the foreground CLI.",
    { reason: "swap_foreground_cli_required" });
  const lines = cleanup ? ["Agent Payment Node Uniswap token allowance cleanup", `Profile: ${op.profile}`, `Operation: ${op.operationId}`,
    `Token/spender: ${op.route.inputToken} / ${op.route.router}`, "Replacement allowance: 0", `Reason: ${op.cleanupReason ?? "residual_allowance"}`,
    `Native debit so far: ${op.accumulatedNativeDebitWei} wei; aggregate cap with this cleanup: ${op.maximumNativeDebitWei} wei`,
    ...(op.cleanupFeeQuote === undefined ? [] : [`Cleanup fee caps re-quoted by the owner at Ethereum block ${op.cleanupFeeQuote.blockNumber} (base fee ${op.cleanupFeeQuote.baseFeePerGasWei} wei, priority fee ${op.cleanupFeeQuote.priorityFeePerGasWei} wei)`,
      `Cleanup max fee per gas: ${op.cleanupGas.maxFeePerGas} wei (frozen: ${op.cleanupFeeQuote.previousCleanupGas.maxFeePerGas}); max priority fee: ${op.cleanupGas.maxPriorityFeePerGas} wei (frozen: ${op.cleanupFeeQuote.previousCleanupGas.maxPriorityFeePerGas}); gas limit ${op.cleanupGas.gasLimit}`,
      `Native debit cap: ${op.maximumNativeDebitWei} wei (was ${op.cleanupFeeQuote.previousMaximumNativeDebitWei})`]),
    ...(op.retiredEffects ?? []).filter((row) => row.kind === "cleanup").map((row) => `Earlier cleanup ${row.attempt.transactionHash}: ${row.reason}`)] :
    ["Agent Payment Node Uniswap V3 token swap approval", `Profile: ${op.profile}`, `Operation: ${op.operationId}`, `Signer: ${op.account}`,
      `Exact input: ${op.route.amountIn} atomic at ${op.route.inputToken}`, `Minimum output: ${op.route.amountOutMinimum} atomic at ${op.route.outputToken}`,
      `Recipient: ${op.route.recipient}`, `Router: ${op.route.router}`, `Exact approval cap: ${op.approvalCapAtomic}`,
      `Aggregate native debit cap: ${op.maximumNativeDebitWei} wei`, `Deadline: ${new Date(op.route.deadline * 1000).toISOString()}`,
      "Approval, swap, and any explicit cleanup are independently signed and broadcast at most once."];
  await exactChainConsent(lines, approvalCode("swap", op.integrityHash, cleanup ? "cleanup" : "execute"),
    cleanup ? new Date(now.getTime() + 300_000).toISOString() : new Date(op.route.deadline * 1000).toISOString(), tty);
}
