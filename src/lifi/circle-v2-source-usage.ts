/** Settles the Base USDC usage hold of a Circle CCTP V2 source burn from its recorded finalized receipt (OWNR-17). */
import { decodeFunctionData, getAddress, parseAbi, type Hex } from "viem";
import { hashObject } from "../canonical.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import type { AssetUsageIdentity } from "../asset-usage-ledger-types.js";
import type { CircleSourceProof } from "./circle-v2-source-proof.js";
import type { NonEvmSourceJournal } from "./non-evm-source-journal.js";

const BASE_USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const ABI = parseAbi(["function depositForBurnWithHookAndFees(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,bytes hookData,(bytes signedQuote,address refundAddress) claim) payable"]);
const OPEN = ["reserved", "submitted", "unknown_finality"] as const;

export interface CircleSourceUsage {
  readonly reservationId: string; readonly state: string; readonly amountAtomic: string; readonly effectAt: string | null;
}

/**
 * A burn whose receipt is recorded at the finalized tag settles the payer's hold once: a successful burn is a finalized
 * spend counted on the day its proof was recorded, a reverted one moved no USDC and releases the hold. Only the hold this
 * operation reserved, for the principal its own burn call carries, is touched; anything else is left as it is.
 */
export async function settleCircleSourceUsage(root: string, journal: NonEvmSourceJournal, proof: CircleSourceProof,
  now: Date): Promise<CircleSourceUsage | null> {
  const identity: AssetUsageIdentity = { account: getAddress(journal.sourceCall.from), chain: "eip155:8453",
    asset: { kind: "token", identifier: BASE_USDC } };
  const ledger = new AssetUsageLedger(root);
  const reservationId = assetUsageReservationId(identity, `circle-v2-base-source:${journal.operationId}`);
  let hold = await ledger.load(identity, reservationId);
  if (hold === null) return null;
  if ((OPEN as readonly string[]).includes(hold.state) && hold.amountAtomic === burnPrincipal(journal)) {
    const outcomeDigest = hashObject({ kind: "circle_v2_base_source_finalized_receipt", operationId: journal.operationId,
      proofIntegrityHash: proof.integrityHash });
    const step = { ...identity, reservationId, policyDigest: hold.policyDigest, now };
    try {
      if (proof.status === "success") {
        hold = await ledger.transition({ ...step, state: "finalized", expectedCurrentStates: [hold.state], outcomeDigest,
          effectAt: proof.observedAt });
      } else {
        // The receipt proves the burn was sent; a hold still `reserved` records that before the revert releases it.
        if (hold.state === "reserved") hold = await ledger.transition({ ...step, state: "submitted", expectedCurrentStates: ["reserved"] });
        hold = await ledger.transition({ ...step, state: "failed_confirmed_revert", expectedCurrentStates: [hold.state], outcomeDigest });
      }
    } catch (error) {
      // A concurrent status may have settled the same hold from the same proof first; anything else stays an error.
      const settled = await ledger.load(identity, reservationId);
      if (settled === null || settled.outcomeDigest !== outcomeDigest) throw error;
      hold = settled;
    }
  }
  return { reservationId, state: hold.state, amountAtomic: hold.amountAtomic, effectAt: hold.effectAt };
}

function burnPrincipal(journal: NonEvmSourceJournal): string | null {
  try {
    const decoded = decodeFunctionData({ abi: ABI, data: journal.sourceCall.data as Hex });
    return decoded.functionName === "depositForBurnWithHookAndFees" ? decoded.args[0].toString() : null;
  } catch { return null; }
}
