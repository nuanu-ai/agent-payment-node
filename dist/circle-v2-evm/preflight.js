/** Pure finite preflight admission. Runtime must obtain all inputs from bounded canonical RPC/API reads under account locks. */
import { encodePacked, keccak256 } from "viem";
import { hashObject } from "../canonical.js";
import { CIRCLE_AMOUNT, CIRCLE_DEPLOYMENT_PINS, CIRCLE_MAX_FEE, CIRCLE_MIN_MINT, CIRCLE_MINTER, CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, circleRoute } from "./catalog.js";
import { assertCircleAttestation, assertCircleSource, circleFail, circleHex, circleRecord, circleUint, circleWord } from "./protocol.js";
/** TokenController.sol hashes abi.encodePacked(uint32 remoteDomain,bytes32 remoteToken), never abi.encode. */
export function circleTokenPairKey(remoteDomain, remoteToken) {
    return keccak256(encodePacked(["uint32", "bytes32"], [remoteDomain, circleWord(remoteToken)]));
}
export function verifyCircleDeployments(source, destination) {
    const route = circleRoute(destination.chainId);
    if (source.chainId !== 42161 || source.domain !== 3 || destination.domain !== route.domain ||
        source.remoteDomain !== route.domain || destination.remoteDomain !== 3 || source.pairedToken !== CIRCLE_SOURCE_TOKEN ||
        destination.pairedToken !== route.token)
        circleFail("deployment_domains_pair");
    for (const snapshot of [source, destination]) {
        if (circleHex(snapshot.blockHash, 32) === `0x${"0".repeat(64)}` || circleUint(snapshot.blockNumberAtomic) < 1n ||
            snapshot.remoteMessenger !== circleWord(CIRCLE_MESSENGER) || snapshot.localMinter !== CIRCLE_MINTER ||
            snapshot.localMessageTransmitter !== CIRCLE_TRANSMITTER || snapshot.localTokenMessenger !== CIRCLE_MESSENGER ||
            snapshot.messageVersion !== 1 || snapshot.messageBodyVersion !== 1 || snapshot.tokenDecimals !== 6 ||
            snapshot.transmitterPaused || snapshot.minterPaused || snapshot.tokenPaused)
            circleFail("deployment_configuration");
        const expected = CIRCLE_DEPLOYMENT_PINS[snapshot.chainId];
        for (const key of ["messenger", "transmitter", "minter", "token"]) {
            const actual = snapshot.contracts[key], pin = expected[key];
            if (actual.address.toLowerCase() !== pin.address.toLowerCase() || actual.proxyCodeHash !== pin.proxyCodeHash ||
                actual.implementation.toLowerCase() !== pin.implementation.toLowerCase() || actual.implementationCodeHash !== pin.implementationCodeHash)
                circleFail("deployment_code_pin");
        }
    }
    return hashObject({ source, destination });
}
/** Ceil exact rational basis points. JSON floating values are accepted only as finite ordinary decimal numbers. */
export function quoteCircleFastFee(chain, value, fetchedAtMs, nowMs) {
    const route = circleRoute(chain);
    if (!Array.isArray(value) || value.length > 4 || !Number.isSafeInteger(fetchedAtMs) || fetchedAtMs > nowMs || nowMs - fetchedAtMs > 30_000)
        circleFail("fee_quote_shape_age");
    const rows = value.map(circleRecord).filter(x => x.finalityThreshold === 1000);
    if (rows.length !== 1)
        circleFail("fast_fee_unavailable");
    const rate = rows[0].minimumFee;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || !/^\d+(?:\.\d{1,6})?$/u.test(String(rate)))
        circleFail("fee_rate");
    const [whole, fraction = ""] = String(rate).split("."), denominator = 10n ** BigInt(fraction.length) * 10000n;
    const numerator = BigInt(`${whole}${fraction}`), fee = (CIRCLE_AMOUNT * numerator + denominator - 1n) / denominator;
    if (fee > CIRCLE_MAX_FEE || CIRCLE_AMOUNT - fee < CIRCLE_MIN_MINT)
        circleFail("fee_cap_or_mint_floor");
    const body = { schemaVersion: "apn.circle-fast-fee.v1", sourceDomain: 3,
        destinationDomain: route.domain, minimumFeeBps: String(rate), quotedFeeAtomic: fee.toString(),
        amountAtomic: "40100", maxFeeAtomic: "100", minMintAtomic: "40000",
        fetchedAtMs, expiresAtMs: fetchedAtMs + 30_000, responseHash: hashObject(value) };
    return { ...body, integrityHash: hashObject(body) };
}
export function assertCircleFeeQuote(quote, chain, nowMs) {
    const { integrityHash, ...body } = quote;
    if (integrityHash !== hashObject(body) || quote.schemaVersion !== "apn.circle-fast-fee.v1" || quote.sourceDomain !== 3 ||
        quote.destinationDomain !== circleRoute(chain).domain || quote.amountAtomic !== "40100" || quote.maxFeeAtomic !== "100" || quote.minMintAtomic !== "40000" ||
        quote.expiresAtMs !== quote.fetchedAtMs + 30_000 || nowMs < quote.fetchedAtMs || nowMs >= quote.expiresAtMs ||
        circleUint(quote.quotedFeeAtomic) > CIRCLE_MAX_FEE)
        circleFail("fee_quote_expired_or_integrity");
}
export function verifyCircleSourceAccount(account) {
    const allowance = circleUint(account.allowanceAtomic);
    if (account.chainId !== 42161 || account.address !== CIRCLE_SOURCE_OWNER || circleUint(account.usdcBalanceAtomic) < CIRCLE_AMOUNT ||
        circleUint(account.nativeBalanceAtomic) < 30000000000000n || account.latestNonceAtomic !== account.pendingNonceAtomic ||
        ![0n, CIRCLE_AMOUNT].includes(allowance))
        circleFail("source_account");
    circleUint(account.latestNonceAtomic);
    return { approvalRequired: allowance === 0n, nonceAtomic: account.latestNonceAtomic };
}
export function verifyCircleDestinationAccount(account, chain) {
    const route = circleRoute(chain);
    if (account.chainId !== chain || account.address !== route.gasPayer ||
        circleUint(account.nativeBalanceAtomic) < BigInt(route.destinationNativeCap) || account.latestNonceAtomic !== account.pendingNonceAtomic)
        circleFail("destination_account");
    circleUint(account.latestNonceAtomic);
    return account.latestNonceAtomic;
}
export function verifyCircleGasEnvelope(envelope, chain, previousSourceFeeAtomic = "0") {
    const gas = circleUint(envelope.gasLimitAtomic), fee = circleUint(envelope.maxFeePerGasAtomic), tip = circleUint(envelope.maxPriorityFeePerGasAtomic), cap = chain === 42161 ? 30000000000000n - circleUint(previousSourceFeeAtomic) : BigInt(circleRoute(chain).destinationNativeCap);
    if (envelope.valueAtomic !== "0" || gas < 21000n || gas > 600000n || fee < 1n || tip > fee || gas * fee > cap)
        circleFail("gas_budget");
    circleUint(envelope.nonceAtomic);
    return (gas * fee).toString();
}
/** An expired attestation requires an explicit read-only API refresh for this burn, never another source effect. */
export function verifyCircleMintPreflight(source, attested, input) {
    assertCircleAttestation(source, attested);
    if (input.attesterConfigurationHash !== attested.attesterConfigurationHash || circleUint(input.usedNonceAtomic) !== 0n ||
        input.previousNonce !== undefined && input.previousNonce !== attested.nonce ||
        BigInt(attested.expirationBlock) !== 0n && BigInt(attested.expirationBlock) <= circleUint(input.destinationBlockAtomic))
        circleFail("mint_nonce_expired_or_attesters_changed");
    if (circleHex(input.transactionSimulationResult, 32) !== `0x${"0".repeat(63)}1`)
        circleFail("mint_simulation");
}
/** Finalization is independent of the issuer's fast attestation threshold. */
export function verifyCircleClosureFinality(source, finalizedSource) {
    assertCircleSource(source);
    assertCircleSource(finalizedSource);
    if (source.finalityTag !== "included" && source.finalityTag !== "finalized" || finalizedSource.finalityTag !== "finalized" ||
        source.transactionHash !== finalizedSource.transactionHash || source.sourceMessageHash !== finalizedSource.sourceMessageHash ||
        source.blockHash !== finalizedSource.blockHash || source.blockNumberAtomic !== finalizedSource.blockNumberAtomic ||
        source.receiptHash !== finalizedSource.receiptHash || source.actualFeeAtomic !== finalizedSource.actualFeeAtomic)
        circleFail("closure_source_finality");
}
//# sourceMappingURL=preflight.js.map