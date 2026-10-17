/** Pure finite preflight admission. Runtime must obtain all inputs from bounded canonical RPC/API reads under account locks. */
import { encodePacked, keccak256 } from "viem";
import { hashObject } from "../canonical.js";
import { CIRCLE_DEPLOYMENT_PINS, CIRCLE_MINTER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, circleRoute } from "./catalog.js";
import { assertCircleAttestation, assertCircleSource, circleFail, circleHex, circleUint, circleWord } from "./protocol.js";
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
        // P5: live snapshots carry no implementation or code hashes, which Circle upgrades legitimately; the pinned proxy
        // addresses, this functional configuration, attester-set signature recovery and the exact simulation stay. Only an
        // anchored snapshot of a frozen recovery path (phase 4) still carries and compares them.
        if (snapshot.contracts === undefined)
            continue;
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
/** `gasPayer` is the operation's own destination custody wallet, which signs and pays the mint. */
export function verifyCircleDestinationAccount(account, chain, gasPayer) {
    const route = circleRoute(chain);
    if (account.chainId !== chain || account.address !== gasPayer ||
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
export function verifyCircleMintPreflight(source, attested, input, binding) {
    assertCircleAttestation(source, attested, binding);
    if (input.attesterConfigurationHash !== attested.attesterConfigurationHash || circleUint(input.usedNonceAtomic) !== 0n ||
        input.previousNonce !== undefined && input.previousNonce !== attested.nonce ||
        BigInt(attested.expirationBlock) !== 0n && BigInt(attested.expirationBlock) <= circleUint(input.destinationBlockAtomic))
        circleFail("mint_nonce_expired_or_attesters_changed");
    if (circleHex(input.transactionSimulationResult, 32) !== `0x${"0".repeat(63)}1`)
        circleFail("mint_simulation");
}
/** Finalization is independent of the issuer's fast attestation threshold. */
export function verifyCircleClosureFinality(source, finalizedSource, binding) {
    assertCircleSource(source, binding);
    assertCircleSource(finalizedSource, binding);
    if (source.finalityTag !== "included" && source.finalityTag !== "finalized" || finalizedSource.finalityTag !== "finalized" ||
        source.transactionHash !== finalizedSource.transactionHash || source.sourceMessageHash !== finalizedSource.sourceMessageHash ||
        source.blockHash !== finalizedSource.blockHash || source.blockNumberAtomic !== finalizedSource.blockNumberAtomic ||
        source.receiptHash !== finalizedSource.receiptHash || source.actualFeeAtomic !== finalizedSource.actualFeeAtomic)
        circleFail("closure_source_finality");
}
//# sourceMappingURL=preflight.js.map