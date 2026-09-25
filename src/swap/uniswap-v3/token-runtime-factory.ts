import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import { approvalCode } from "../../approval-code.js";
import { ApnError } from "../../errors.js";
import { assertExclusiveRelayExecutionOwner } from "../../evm-address-ownership.js";
import { EncryptedSmartAccountPermissionStore } from "../../encrypted-smart-account-permission-store.js";
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
import { UniswapTokenRevalidator } from "./token-revalidation.js";
import { UniswapTokenSigningGuard } from "./token-guard.js";
import { UniswapTokenUsage } from "./token-usage.js";
import { InstalledUniswapTokenRuntime } from "./token-runtime.js";
import { UniswapTokenRpcBudgetJournal } from "./token-rpc-budget.js";
import type { TokenRpcCall } from "./token-rpc.js";

export function createUniswapTokenRuntime(input: { readonly state: StateStore; readonly wrapping: WrappingSecretPort;
  readonly clock: ClockPort; readonly call: EvmRpcCall; readonly foreground: "approve" | "cleanup" | "refuse";
  readonly tty?: TtyTransferApprovalOptions; readonly verifyPins?: (call: EvmRpcCall, tag: import("viem").Hex) => Promise<void> }): UniswapTokenCommandRuntime {
  const { state, wrapping, clock, call } = input, materials = new SavedUniswapTokenMaterialStore(state.root), custody = new UniswapTokenCustody(state, wrapping, call, () => clock.now()),
    observer = new UniswapTokenObserver(call), revalidator = new UniswapTokenRevalidator(call, input.verifyPins), ledger = new AssetUsageLedger(state.root),
    usage = new UniswapTokenUsage(state, clock, ledger), guard = new UniswapTokenSigningGuard(state, wrapping, call, usage, () => clock.now(), input.verifyPins),
    permissions = new EncryptedSmartAccountPermissionStore(state, wrapping);
  const approveOwner = async (op: UniswapTokenOperation) =>
    await assertExclusiveRelayExecutionOwner(state, permissions, op.account, state.profileHash(op.profile));
  const ports: UniswapTokenExecutionPorts & { confirm(material: import("./token-material.js").UniswapTokenMaterial): Promise<void> } = {
    now: () => clock.now(), withAccountLock: async (op, work) => await custody.withAccountLock(op, work),
    allocateNonce: async (op, kind) => await custody.allocateNonce(op, kind), currentAllowance: async (op) => await custody.currentAllowance(op),
    releaseNonce: async (op, kind, nonce) => { await custody.releaseNonce(op, kind, nonce); },
    commitNonce: async (op, kind, nonce) => { await custody.commitNonce(op, kind, nonce); },
    guard: async (op, kind, nonce) => await guard.inspect(op, kind, nonce), reserveUsage: async (op) => await usage.reserve(op),
    currentUsage: async (op) => await usage.current(op), followUsage: async (op, target) => await usage.follow(op, target),
    revalidate: async (op) => await revalidator.revalidate(op), seal: async (op, kind, nonce) => await custody.seal(op, kind, nonce),
    probeSealed: async (op, kind, nonce) => await custody.probeSealed(op, kind, nonce),
    send: async (op, kind) => await custody.send(op, kind), observe: async (op, kind, hash) => {
      await custody.bindEffectProvider(op, kind); return await observer.observe(op, kind, hash); },
    foregroundApprove: async (op) => { await approveOwner(op); await foreground(input.foreground === "approve", op, false, clock.now(), input.tty); await approveOwner(op); },
    foregroundCleanup: async (op) => { await approveOwner(op); await foreground(input.foreground === "cleanup", op, true, clock.now(), input.tty); await approveOwner(op); },
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
    `Token/spender: ${op.route.inputToken} / ${op.route.router}`, "Replacement allowance: 0", `Reason: ${op.cleanupReason ?? "residual_allowance"}`] :
    ["Agent Payment Node Uniswap V3 token swap approval", `Profile: ${op.profile}`, `Operation: ${op.operationId}`, `Signer: ${op.account}`,
      `Exact input: ${op.route.amountIn} atomic at ${op.route.inputToken}`, `Minimum output: ${op.route.amountOutMinimum} atomic at ${op.route.outputToken}`,
      `Recipient: ${op.route.recipient}`, `Router: ${op.route.router}`, `Exact approval cap: ${op.approvalCapAtomic}`,
      `Aggregate native debit cap: ${op.maximumNativeDebitWei} wei`, `Deadline: ${new Date(op.route.deadline * 1000).toISOString()}`,
      "Approval, swap, and any explicit cleanup are independently signed and broadcast at most once."];
  await exactChainConsent(lines, approvalCode("swap", op.integrityHash, cleanup ? "cleanup" : "execute"),
    cleanup ? new Date(now.getTime() + 300_000).toISOString() : new Date(op.route.deadline * 1000).toISOString(), tty);
}
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
