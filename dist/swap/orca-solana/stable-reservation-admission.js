import { AssetUsageLedger, assetUsageReservationId } from "../../asset-usage-ledger.js";
import { ApnError } from "../../errors.js";
import { ORCA_SOLANA_CHAIN, USDC_MINT } from "./pins.js";
/** Exclude this operation's own durable reservation from a later admission check after a crash. */
export function stableReservationAdmissionPorts(ports, usage, operation) {
    const identity = { account: operation.quote.account, chain: ORCA_SOLANA_CHAIN,
        asset: { kind: "token", identifier: USDC_MINT } };
    const reservationId = assetUsageReservationId(identity, `swap-${operation.idempotencyHash}`);
    return { ...ports, dailyUsage: async (owner, mint, now) => {
            if (owner !== operation.quote.account || mint !== USDC_MINT)
                return await ports.dailyUsage(owner, mint, now);
            const { snapshot, reservation } = await usage.usageWithReservation(identity, reservationId, now);
            if (reservation === null)
                return await ports.dailyUsage(owner, mint, now);
            if (reservation.state !== "reserved" || reservation.policyDigest !== operation.policyDigest ||
                reservation.amountAtomic !== operation.quote.inputAmountAtomic || reservation.rail !== "swap")
                throw new ApnError("APN_STATE_CORRUPT", "Stable principal reservation differs from the prepared operation.");
            const remaining = BigInt(snapshot.amountAtomic) - BigInt(reservation.amountAtomic);
            if (remaining < 0n)
                throw new ApnError("APN_STATE_CORRUPT", "Stable principal usage is inconsistent.");
            return remaining.toString();
        } };
}
//# sourceMappingURL=stable-reservation-admission.js.map