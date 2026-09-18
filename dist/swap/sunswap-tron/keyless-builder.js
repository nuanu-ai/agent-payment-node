import { exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { tronAddress, tronAtomic, tronHex } from "../../tron/codec.js";
import { assertTronNetwork } from "../../tron/rpc.js";
import { encodeSunSwapCalldata } from "./calldata.js";
import { loadSunSwapPinCatalog } from "./catalog.js";
import { priceSunSwapV2Market, readSunSwapV2Market } from "./market.js";
import { SUNSWAP_EXECUTION_MATERIAL_SCHEMA, sunSwapGasOrEnergy } from "./prepared.js";
import { createSunSwapQuoteSnapshot } from "./quote.js";
import { simulateSunSwapTransaction } from "./simulation.js";
import { buildSunSwapUnsignedTransaction, sunSwapMaximumBandwidthBytes, sunSwapUnsignedPayloadHash, } from "./transaction.js";
const PROFILE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MAX_WINDOW_MS = 600000n;
/**
 * Keyless SunSwap V2 builder: price, output and reserves come from the pinned router and pair via constant calls, the
 * unsigned TriggerSmartContract is encoded locally from the pinned ABI, and the exact call is simulated from the owner.
 * It never signs, broadcasts, or calls an off-chain quote API.
 */
export class SunSwapKeylessQuoteBuilder {
    rpc;
    store;
    constructor(rpc, store) {
        this.rpc = rpc;
        this.store = store;
    }
    inventory() { return { catalog: loadSunSwapPinCatalog(), admitted: false }; }
    async quote(input) {
        const request = validateRequest(input);
        await assertTronNetwork(this.rpc);
        const parameters = await chainParameters(this.rpc);
        if (BigInt(request.feeLimitSun) > parameters.maximumFeeLimitSun) {
            throw new ApnError("APN_INVALID_INPUT", "SunSwap fee_limit exceeds the TRON chain maximum fee limit.");
        }
        const market = await readSunSwapV2Market(this.rpc, { caller: request.account, amountInAtomic: request.amountAtomic });
        const pricing = priceSunSwapV2Market(market, request.slippageBps, request.ownerSlippageCapBps);
        const deadlineSeconds = request.deadline.toString(), nowMs = request.now.getTime().toString();
        const intent = { owner: request.account, recipient: request.recipient, inputAmountAtomic: request.amountAtomic,
            minimumOutputAtomic: pricing.minimumOutputAtomic, deadlineSeconds, calldata: encodeSunSwapCalldata({ owner: request.account,
                recipient: request.recipient, inputAmountAtomic: request.amountAtomic, minimumOutputAtomic: pricing.minimumOutputAtomic, deadlineSeconds }),
            callValueAtomic: request.amountAtomic, referenceBlockId: market.referenceBlock.id, timestampMs: nowMs,
            expirationMs: (BigInt(request.deadline) * 1000n).toString(), feeLimitSun: request.feeLimitSun,
            maximumEnergy: (BigInt(request.feeLimitSun) / parameters.energyPriceSun).toString(), energyPriceSun: parameters.energyPriceSun.toString(),
            maximumFeeLimitSun: request.feeLimitSun };
        const transaction = buildSunSwapUnsignedTransaction(intent);
        const simulation = await simulateSunSwapTransaction(this.rpc, transaction, intent);
        const bandwidthFeeSun = sunSwapMaximumBandwidthBytes(transaction) * parameters.bandwidthPriceSun;
        await assertOwnerFunding(this.rpc, request.account, BigInt(request.amountAtomic) + BigInt(request.feeLimitSun) + bandwidthFeeSun);
        const { energyRequired: _energy, feeLimitSun: _fee, ...proof } = simulation;
        const quote = createSunSwapQuoteSnapshot({ profile: request.profile, account: request.account, recipient: request.recipient,
            slippageBps: request.slippageBps, ownerSlippageCapBps: request.ownerSlippageCapBps, effectiveAt: request.now.toISOString(),
            expiresAt: new Date(Number(intent.expirationMs)).toISOString(), unsignedTransactionPayloadHash: sunSwapUnsignedPayloadHash(transaction),
            market, simulation: proof });
        const bandwidthPriceSun = parameters.bandwidthPriceSun.toString();
        return await this.store.save({ quote, approvalCapAtomic: "0", gasOrEnergy: sunSwapGasOrEnergy(intent, simulation, transaction, bandwidthPriceSun),
            execution: { schemaVersion: SUNSWAP_EXECUTION_MATERIAL_SCHEMA, intent, transaction, simulation, market, pricing, bandwidthPriceSun } });
    }
    async load(quoteHash) {
        if (typeof quoteHash !== "string" || !/^[a-f0-9]{64}$/u.test(quoteHash)) {
            throw new ApnError("APN_INVALID_INPUT", "SunSwap quote hash must be 64 lowercase hexadecimal characters.");
        }
        return await this.store.load(quoteHash);
    }
}
function validateRequest(input) {
    if (!isPlainRecord(input) || !exactKeys(input, ["command", "profile", "account", "recipient", "amountAtomic", "slippageBps",
        "ownerSlippageCapBps", "feeLimitSun", "deadline", "now"])) {
        invalid("SunSwap V2 quote requires exactly command, profile, account, recipient, amountAtomic, slippageBps, " +
            "ownerSlippageCapBps, feeLimitSun, deadline and now; fee_limit and deadline have no default.");
    }
    if (input.command !== "swap.sunswap.quote" ||
        typeof input.profile !== "string" || !PROFILE.test(input.profile) || typeof input.account !== "string" ||
        tronAddress(input.account) !== input.account || input.recipient !== input.account) {
        invalid("SunSwap V2 quote requires a canonical owner account that is also the recipient.");
    }
    if (typeof input.amountAtomic !== "string" || !/^[1-9][0-9]{0,15}$/u.test(input.amountAtomic) ||
        BigInt(input.amountAtomic) > BigInt(Number.MAX_SAFE_INTEGER))
        invalid("SunSwap amount must be a positive safe SUN integer.");
    if (!Number.isSafeInteger(input.slippageBps) || !Number.isSafeInteger(input.ownerSlippageCapBps) || input.slippageBps < 0 ||
        input.ownerSlippageCapBps > 10_000 || input.slippageBps > input.ownerSlippageCapBps)
        invalid("SunSwap slippage exceeds the owner cap.");
    if (typeof input.feeLimitSun !== "string" || !/^[1-9][0-9]{0,15}$/u.test(input.feeLimitSun)) {
        invalid("SunSwap requires an explicit positive owner fee_limit in SUN.");
    }
    if (!(input.now instanceof Date) || !Number.isSafeInteger(input.now.getTime()) || input.now.getTime() <= 0 || !Number.isSafeInteger(input.deadline)) {
        invalid("SunSwap quote time and deadline must be exact.");
    }
    const window = BigInt(input.deadline) * 1000n - BigInt(input.now.getTime());
    if (window <= 0n || window > MAX_WINDOW_MS)
        invalid("SunSwap deadline must be within the next 10 minutes (TRON expiration bound).");
    return input;
}
async function chainParameters(rpc) {
    let value;
    try {
        value = await rpc.call("wallet/getchainparameters", {});
    }
    catch (error) {
        return unavailable(error);
    }
    if (!isPlainRecord(value) || !Array.isArray(value.chainParameter) || value.chainParameter.length > 512)
        protocol();
    const read = (key) => {
        const rows = value.chainParameter.filter((row) => isPlainRecord(row) && row.key === key);
        if (rows.length !== 1)
            protocol();
        const amount = tronAtomic(rows[0].value);
        if (amount <= 0n)
            protocol();
        return amount;
    };
    return { energyPriceSun: read("getEnergyFee"), maximumFeeLimitSun: read("getMaxFeeLimit"), bandwidthPriceSun: read("getTransactionFee") };
}
/** Economic guard: the owner must hold the call value, the full fee_limit and the full bandwidth burn before any signing exists. */
async function assertOwnerFunding(rpc, owner, requiredSun) {
    let value;
    try {
        value = await rpc.call("wallet/getaccount", { address: tronHex(owner), visible: false });
    }
    catch (error) {
        return unavailable(error);
    }
    if (!isPlainRecord(value))
        protocol();
    if (Object.keys(value).length === 0) {
        throw new ApnError("APN_INSUFFICIENT_ASSET", "The owner TRON account is not activated.", { reason: "sunswap_owner_not_activated" });
    }
    if (value.address !== tronHex(owner))
        protocol();
    if (tronAtomic(value.balance, true) < requiredSun) {
        throw new ApnError("APN_INSUFFICIENT_ASSET", "Owner TRX cannot cover the call value plus the owner fee_limit and bandwidth budget.", { reason: "sunswap_owner_trx_insufficient" });
    }
}
function unavailable(error) {
    if (error instanceof ApnError && (error.code === "APN_RPC_CONFIG" || error.code === "APN_RPC_PROTOCOL"))
        throw error;
    throw new ApnError("APN_RPC_PROTOCOL", "The bounded TRON read did not return valid SunSwap evidence.");
}
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
function protocol() { throw new ApnError("APN_RPC_PROTOCOL", "TRON returned SunSwap chain evidence with an invalid shape."); }
//# sourceMappingURL=keyless-builder.js.map