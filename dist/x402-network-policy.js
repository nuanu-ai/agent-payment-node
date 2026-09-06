import { sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { assertUnattendedX402Balance, effectiveX402Cap, requireProfilePolicy } from "./profile-policy.js";
import { assertLocalNetworkProfile, x402Network } from "./x402-network.js";
import { resolveX402Payer } from "./x402-payer.js";
import { tokenDomainSeparator, validatePrepareEvidence } from "./x402-policy.js";
import { assertX402RpcChain, boundedX402PrepareRpc, selectX402Rpc } from "./x402-service-rpc.js";
export async function assertCurrentNetworkPolicy(context, operation, callerDeadlineMs) {
    if (operation.chainId === "8453")
        return;
    const selected = x402Network(operation.network);
    await assertLocalNetworkProfile(context, operation.profile, selected.chainId);
    const payer = await resolveX402Payer(context, operation.profileHash, selected.chainId);
    if (payer.wallet !== operation.wallet || payer.transferMethod !== "eip3009")
        throw new ApnError("APN_WALLET_MISMATCH", "Current local payer differs from the frozen x402 wallet.");
    const policy = requireProfilePolicy(await context.requirePolicy().load(payer.policy));
    effectiveX402Cap(policy, operation.capAtomic);
    const selectedRpc = selectX402Rpc(context.requireRpc(), selected.chainId);
    const remainingMs = callerDeadlineMs === undefined ? undefined : Math.floor(callerDeadlineMs - context.wait.nowMs());
    if (remainingMs !== undefined && remainingMs < 1)
        throw new ApnError("APN_STATE_BUSY", "Settlement wait expired before first-exposure policy checks.");
    const rpc = remainingMs === undefined ? selectedRpc : boundedX402PrepareRpc(selectedRpc, Math.min(20000, remainingMs));
    const invocationStartedAtMs = context.clock.now().getTime();
    const chain = await assertX402RpcChain(rpc, selected.chainId);
    const evidence = await rpc.getX402PrepareEvidence(operation.wallet);
    await assertX402RpcChain(rpc, selected.chainId);
    validatePrepareEvidence(evidence, operation.wallet, {
        rpcOriginHash: sha256(chain.rpcOrigin), invocationStartedAtMs, invocationCompletedAtMs: context.clock.now().getTime(),
    }, "eip3009");
    const resolved = operation.selectedOffer.resolved;
    if (resolved.assetTransferMethod !== "eip3009" || evidence.tokenName !== resolved.tokenName || evidence.tokenVersion !== resolved.tokenVersion ||
        evidence.domainSeparator !== tokenDomainSeparator(resolved.tokenName, resolved.tokenVersion, selected.chainId) ||
        BigInt(evidence.block.number) < BigInt(operation.preparedBlock.number)) {
        throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "Current token domain or safe block does not bind the frozen x402 authorization.");
    }
    assertUnattendedX402Balance(policy, evidence.usdcAtomic);
    if (BigInt(evidence.usdcAtomic) < BigInt(operation.amountAtomic))
        throw new ApnError("APN_INSUFFICIENT_USDC", "Current selected-network USDC is insufficient.");
}
//# sourceMappingURL=x402-network-policy.js.map