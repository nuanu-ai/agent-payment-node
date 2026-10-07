import { canonicalJson } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { GuardedSwapApprovalIntent } from "../runtime.js";
import { guardJupiterV1WhirlpoolMaterial } from "./v1-guard.js";
import type { JupiterV1PreparedMaterial } from "./v1-material.js";
export async function jupiterV1ApprovalScreen(material:JupiterV1PreparedMaterial,intent:GuardedSwapApprovalIntent):Promise<readonly string[]>{
 const q=material.quote,g=await guardJupiterV1WhirlpoolMaterial(material.execution,{deadline:intent.deadline});
 if(q.profile!==intent.profile||q.quoteHash!==intent.quoteHash||q.account!==intent.account||q.recipient!==intent.recipient||
 q.inputAmountAtomic!==intent.inputAmountAtomic||q.expectedOutputAtomic!==intent.expectedOutputAtomic||q.minimumOutputAtomic!==intent.minimumOutputAtomic||
 q.slippageBps!==intent.slippageBps||canonicalJson(material.gasOrEnergy)!==canonicalJson(intent.gasOrEnergy))throw new ApnError("APN_OPERATION_BLOCKED","Jupiter's authoritative prepared quote differs from the approval intent.");
 return [g.routeId===undefined?"Agent Payment Node: Jupiter V1 direct Whirlpool, Solana mainnet":"Agent Payment Node: Jupiter V1 WhirlpoolSwapV2, Solana mainnet",`Profile: ${intent.profile}`,`Operation: ${intent.operationId}`,
 `Local software signer and fee payer: ${intent.account}`,`Send exactly ${intent.inputAmountAtomic} lamports SOL; recipient is your own USDC account ${g.destinationTokenAccount}`,
 `Expected USDC: ${intent.expectedOutputAtomic} atomic; observed acceptance minimum: ${g.quotedMinimumOutputAtomic} atomic`,
 `Client expected instruction floor: ${g.instructionMinimumOutputAtomic} atomic; API ceiling: ${g.quotedMinimumOutputAtomic}; rounding difference: ${g.minimumRoundingDeltaAtomic}`,
 "Simulation and the actual finalized receipt must each satisfy both minima. The floor is client arithmetic, with no deployed-source attestation.",
 `Temporary own WSOL account: ${g.sourceTokenAccount}; wrap input exactly, then close to the same payer`,
 `Pool: ${g.pool}; slippage: ${intent.slippageBps} bps; platform fee and token approval cap: 0`,
 `Network fee: ${material.execution.networkFeeLamports} lamports; temporary token rent: ${material.execution.tokenAccountRentLamports} lamports`,
 `Maximum native expense: ${g.maximumNativeExpenseLamports} lamports (input, rent, base fee and priority fee)`,
 "Root-approved runtime read cap: 64 logical network calls per quote/execute/observe stage, prepare 0, 192 cumulative; authority: runtime_cap.",
 `Exact message: ${material.execution.messageHash}; frozen blockhash: ${material.execution.lifetime.blockhash}; last valid height: ${material.execution.lifetime.lastValidBlockHeight}`,
 ...(material.execution.quoteRpcLifetime === undefined ? [] : [`Blockhash source: configured mainnet RPC before quote freeze; confirmed context ${material.execution.quoteRpcLifetime.contextSlot}; original official build hash ${material.execution.rawBuildResponseHash}`]),
 `Quote: ${intent.quoteHash}; policy: ${intent.policyDigest}; mechanism: ${intent.mechanismDigest}`,
 `Deadline: ${intent.deadline}`,
 "Runtime byte pins and exact simulation prove this execution; source reproducibility remains unproved.",
 "Approval authorizes one local signature and one send. Every later status only observes the same signature."];
}
