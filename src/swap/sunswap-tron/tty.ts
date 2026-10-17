import { chainDisplay } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import type { GuardedSwapApprovalIntent } from "../runtime.js";
import { assertSwapMaterialMatchesIntent, requiredDisplay as required } from "../tty-consent.js";
import { SUNSWAP_V2_ROUTER, SUNSWAP_V2_WTRX_USDT_PAIR } from "./catalog.js";
import type { SunSwapPreparedMaterialPort } from "./prepared.js";

/** TRON accepts a transaction only while its reference block is among the last 65536 blocks (TAPOS). */
const TAPOS_WINDOW_BLOCKS = 65_536n;

/** The exact foreground screen for one guarded SunSwap swap (consent: TtyGuardedSwapApproval "sunswap"). */
export async function sunSwapApprovalScreen(store: Pick<SunSwapPreparedMaterialPort, "load">,
  intent: GuardedSwapApprovalIntent): Promise<readonly string[]> {
  const material = await store.load(intent.quoteHash);
  if (material === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Prepared swap quote was not found.");
  const { intent: frozen, market, pricing } = material.execution;
  assertSwapMaterialMatchesIntent(material, intent, { deadline: true });
  const r = intent.gasOrEnergy, trx = (key: string) => `${chainDisplay(required(r, key), 6)} TRX (${required(r, key)} SUN)`;
  const reference = BigInt(market.referenceBlock.number);
  return [
    "Agent Payment Node guarded swap approval: TRON mainnet, SunSwap V2, keyless",
    `Profile: ${intent.profile}`, `Operation: ${intent.operationId}`, `Signer (local TRON key, non-custodial): ${intent.account}`,
    `You send: ${chainDisplay(intent.inputAmountAtomic, 6)} TRX (${intent.inputAmountAtomic} SUN), native, exact input`,
    `Recipient of USDT: ${intent.recipient}`,
    `Expected in: ${chainDisplay(intent.expectedOutputAtomic, 6)} USDT (${intent.expectedOutputAtomic} atomic, router getAmountsOut at block ${market.referenceBlock.number})`,
    `Minimum in: ${chainDisplay(intent.minimumOutputAtomic, 6)} USDT (${intent.minimumOutputAtomic} atomic); the router reverts below this`,
    `Slippage cap: ${intent.slippageBps} basis points`,
    `Price impact vs pair reserve spot, including the ${Number(pricing.lpFeeBps) / 100}% LP fee: ${pricing.priceImpactBps} basis points`,
    `Energy estimate: ${required(r, "energyUsed")} energy at ${required(r, "energyPriceSun")} SUN = ${trx("estimatedEnergyFeeSun")} (exact simulation)`,
    `fee_limit: ${trx("feeLimitSun")}; it caps the energy burn at ${required(r, "maximumEnergy")} energy`,
    `Bandwidth budget: ${required(r, "maximumBandwidthBytes")} bytes at ${required(r, "bandwidthPriceSun")} SUN = ${trx("maximumBandwidthFeeSun")}, burned only without free or staked bandwidth`,
    `Maximum TRX debit: ${trx("maximumTrxDebitSun")} = input + fee_limit + bandwidth budget`,
    `Deadline: ${intent.deadline} (unix ${frozen.deadlineSeconds}); the signed transaction expires at the same instant`,
    `Reference block: ${market.referenceBlock.number} (${market.referenceBlock.id}); it stays usable through block ${(reference + TAPOS_WINDOW_BLOCKS - 1n).toString()}`,
    `Token approval cap: ${material.approvalCapAtomic} (native TRX input needs no TRC20 allowance)`,
    `Pool: ${SUNSWAP_V2_WTRX_USDT_PAIR} (WTRX/USDT V2 pair); router: SunSwap V2 ${SUNSWAP_V2_ROUTER}`,
    `Quote: ${intent.quoteHash}`, `Policy: ${intent.policyDigest}`, `Mechanism: ${intent.mechanismDigest}`,
    "APN signs locally and broadcasts exactly once. After that attempt, status only observes this exact transaction.",
  ];
}
