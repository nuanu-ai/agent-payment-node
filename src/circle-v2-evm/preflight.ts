/** Pure finite preflight admission. Runtime must obtain all inputs from bounded canonical RPC/API reads under account locks. */
import { encodePacked, keccak256, type Address, type Hex } from "viem";
import { hashObject } from "../canonical.js";
import { CIRCLE_AMOUNT, CIRCLE_DEPLOYMENT_PINS, CIRCLE_MAX_FEE, CIRCLE_MIN_MINT, CIRCLE_MINTER,
  CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, circleRoute, type CircleDestinationChain } from "./catalog.js";
import { assertCircleAttestation, assertCircleSource, circleFail, circleHex, circleRecord, circleUint, circleWord,
  type CircleAttestation, type CircleSourceProof } from "./protocol.js";
export interface CircleContractSnapshot { readonly address: string; readonly proxyCodeHash: string;
  readonly implementation: string; readonly implementationCodeHash: string | null; }
export interface CircleDeploymentSnapshot {
  readonly chainId: 42161 | CircleDestinationChain; readonly domain: number;
  readonly blockHash: Hex; readonly blockNumberAtomic: string;
  readonly contracts: Readonly<Record<"messenger" | "transmitter" | "minter" | "token", CircleContractSnapshot>>;
  readonly remoteDomain: number; readonly remoteMessenger: Hex; readonly pairedToken: Address;
  readonly localMinter: Address; readonly localMessageTransmitter: Address; readonly localTokenMessenger: Address;
  readonly messageVersion: number; readonly messageBodyVersion: number; readonly tokenDecimals: number;
  readonly transmitterPaused: boolean; readonly minterPaused: boolean; readonly tokenPaused: boolean;
}
/** TokenController.sol hashes abi.encodePacked(uint32 remoteDomain,bytes32 remoteToken), never abi.encode. */
export function circleTokenPairKey(remoteDomain: number, remoteToken: Address): Hex {
  return keccak256(encodePacked(["uint32", "bytes32"], [remoteDomain, circleWord(remoteToken)]));
}
export function verifyCircleDeployments(source: CircleDeploymentSnapshot, destination: CircleDeploymentSnapshot): string {
  const route = circleRoute(destination.chainId as CircleDestinationChain);
  if (source.chainId !== 42161 || source.domain !== 3 || destination.domain !== route.domain ||
    source.remoteDomain !== route.domain || destination.remoteDomain !== 3 || source.pairedToken !== CIRCLE_SOURCE_TOKEN ||
    destination.pairedToken !== route.token) circleFail("deployment_domains_pair");
  for (const snapshot of [source, destination]) {
    if (circleHex(snapshot.blockHash, 32) === `0x${"0".repeat(64)}` || circleUint(snapshot.blockNumberAtomic) < 1n ||
      snapshot.remoteMessenger !== circleWord(CIRCLE_MESSENGER) || snapshot.localMinter !== CIRCLE_MINTER ||
      snapshot.localMessageTransmitter !== CIRCLE_TRANSMITTER || snapshot.localTokenMessenger !== CIRCLE_MESSENGER ||
      snapshot.messageVersion !== 1 || snapshot.messageBodyVersion !== 1 || snapshot.tokenDecimals !== 6 ||
      snapshot.transmitterPaused || snapshot.minterPaused || snapshot.tokenPaused) circleFail("deployment_configuration");
    const expected = CIRCLE_DEPLOYMENT_PINS[snapshot.chainId];
    for (const key of ["messenger", "transmitter", "minter", "token"] as const) {
      const actual = snapshot.contracts[key], pin = expected[key];
      if (actual.address.toLowerCase() !== pin.address.toLowerCase() || actual.proxyCodeHash !== pin.proxyCodeHash ||
        actual.implementation.toLowerCase() !== pin.implementation.toLowerCase() || actual.implementationCodeHash !== pin.implementationCodeHash) circleFail("deployment_code_pin");
    }
  }
  return hashObject({ source, destination });
}
export interface CircleFeeQuote { readonly schemaVersion: "apn.circle-fast-fee.v1"; readonly sourceDomain: 3;
  readonly destinationDomain: 16 | 11 | 15; readonly minimumFeeBps: string; readonly quotedFeeAtomic: string;
  readonly amountAtomic: "40100"; readonly maxFeeAtomic: "100"; readonly minMintAtomic: "40000";
  readonly fetchedAtMs: number; readonly expiresAtMs: number; readonly responseHash: string; readonly integrityHash: string; }
/** Ceil exact rational basis points. JSON floating values are accepted only as finite ordinary decimal numbers. */
export function quoteCircleFastFee(chain: CircleDestinationChain, value: unknown, fetchedAtMs: number, nowMs: number): CircleFeeQuote {
  const route = circleRoute(chain);
  if (!Array.isArray(value) || value.length > 4 || !Number.isSafeInteger(fetchedAtMs) || fetchedAtMs > nowMs || nowMs - fetchedAtMs > 30_000) circleFail("fee_quote_shape_age");
  const rows = value.map(circleRecord).filter(x => x.finalityThreshold === 1000);
  if (rows.length !== 1) circleFail("fast_fee_unavailable");
  const rate = rows[0]!.minimumFee;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || !/^\d+(?:\.\d{1,6})?$/u.test(String(rate))) circleFail("fee_rate");
  const [whole, fraction = ""] = String(rate).split("."), denominator = 10n ** BigInt(fraction.length) * 10_000n;
  const numerator = BigInt(`${whole}${fraction}`), fee = (CIRCLE_AMOUNT * numerator + denominator - 1n) / denominator;
  if (fee > CIRCLE_MAX_FEE || CIRCLE_AMOUNT - fee < CIRCLE_MIN_MINT) circleFail("fee_cap_or_mint_floor");
  const body = { schemaVersion: "apn.circle-fast-fee.v1" as const, sourceDomain: 3 as const,
    destinationDomain: route.domain, minimumFeeBps: String(rate), quotedFeeAtomic: fee.toString(),
    amountAtomic: "40100" as const, maxFeeAtomic: "100" as const, minMintAtomic: "40000" as const,
    fetchedAtMs, expiresAtMs: fetchedAtMs + 30_000, responseHash: hashObject(value) };
  return { ...body, integrityHash: hashObject(body) };
}
export function assertCircleFeeQuote(quote: CircleFeeQuote, chain: CircleDestinationChain, nowMs: number): void {
  const { integrityHash, ...body } = quote;
  if (integrityHash !== hashObject(body) || quote.schemaVersion !== "apn.circle-fast-fee.v1" || quote.sourceDomain !== 3 ||
    quote.destinationDomain !== circleRoute(chain).domain || quote.amountAtomic !== "40100" || quote.maxFeeAtomic !== "100" || quote.minMintAtomic !== "40000" ||
    quote.expiresAtMs !== quote.fetchedAtMs + 30_000 || nowMs < quote.fetchedAtMs || nowMs >= quote.expiresAtMs ||
    circleUint(quote.quotedFeeAtomic) > CIRCLE_MAX_FEE) circleFail("fee_quote_expired_or_integrity");
}
export interface CircleAccountPreflight { readonly chainId: number; readonly address: Address;
  readonly nativeBalanceAtomic: string; readonly usdcBalanceAtomic: string; readonly allowanceAtomic: string;
  readonly latestNonceAtomic: string; readonly pendingNonceAtomic: string; }
export function verifyCircleSourceAccount(account: CircleAccountPreflight): { readonly approvalRequired: boolean; readonly nonceAtomic: string } {
  const allowance = circleUint(account.allowanceAtomic);
  if (account.chainId !== 42161 || account.address !== CIRCLE_SOURCE_OWNER || circleUint(account.usdcBalanceAtomic) < CIRCLE_AMOUNT ||
    circleUint(account.nativeBalanceAtomic) < 30_000_000_000_000n || account.latestNonceAtomic !== account.pendingNonceAtomic ||
    ![0n, CIRCLE_AMOUNT].includes(allowance)) circleFail("source_account");
  circleUint(account.latestNonceAtomic); return { approvalRequired: allowance === 0n, nonceAtomic: account.latestNonceAtomic };
}
export function verifyCircleDestinationAccount(account: CircleAccountPreflight, chain: CircleDestinationChain, destinationProfile?: string): string {
  const route = circleRoute(chain, destinationProfile);
  if (account.chainId !== chain || account.address !== route.gasPayer ||
    circleUint(account.nativeBalanceAtomic) < BigInt(route.destinationNativeCap) || account.latestNonceAtomic !== account.pendingNonceAtomic) circleFail("destination_account");
  circleUint(account.latestNonceAtomic); return account.latestNonceAtomic;
}
export interface CircleGasEnvelope { readonly gasLimitAtomic: string; readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string; readonly valueAtomic: "0"; readonly nonceAtomic: string; }
export function verifyCircleGasEnvelope(envelope: CircleGasEnvelope, chain: 42161 | CircleDestinationChain,
  previousSourceFeeAtomic = "0"): string {
  const gas = circleUint(envelope.gasLimitAtomic), fee = circleUint(envelope.maxFeePerGasAtomic), tip = circleUint(envelope.maxPriorityFeePerGasAtomic),
    cap = chain === 42161 ? 30_000_000_000_000n - circleUint(previousSourceFeeAtomic) : BigInt(circleRoute(chain).destinationNativeCap);
  if (envelope.valueAtomic !== "0" || gas < 21_000n || gas > 600_000n || fee < 1n || tip > fee || gas * fee > cap) circleFail("gas_budget");
  circleUint(envelope.nonceAtomic); return (gas * fee).toString();
}
/** An expired attestation requires an explicit read-only API refresh for this burn, never another source effect. */
export function verifyCircleMintPreflight(source: CircleSourceProof, attested: CircleAttestation, input: {
  readonly destinationBlockAtomic: string; readonly usedNonceAtomic: string; readonly attesterConfigurationHash: string;
  readonly transactionSimulationResult: Hex; readonly previousNonce?: Hex;
}): void {
  assertCircleAttestation(source, attested);
  if (input.attesterConfigurationHash !== attested.attesterConfigurationHash || circleUint(input.usedNonceAtomic) !== 0n ||
    input.previousNonce !== undefined && input.previousNonce !== attested.nonce ||
    BigInt(attested.expirationBlock) !== 0n && BigInt(attested.expirationBlock) <= circleUint(input.destinationBlockAtomic)) circleFail("mint_nonce_expired_or_attesters_changed");
  if (circleHex(input.transactionSimulationResult, 32) !== `0x${"0".repeat(63)}1`) circleFail("mint_simulation");
}
/** Finalization is independent of the issuer's fast attestation threshold. */
export function verifyCircleClosureFinality(source: CircleSourceProof, finalizedSource: CircleSourceProof): void {
  assertCircleSource(source); assertCircleSource(finalizedSource);
  if (source.finalityTag !== "included" && source.finalityTag !== "finalized" || finalizedSource.finalityTag !== "finalized" ||
    source.transactionHash !== finalizedSource.transactionHash || source.sourceMessageHash !== finalizedSource.sourceMessageHash ||
    source.blockHash !== finalizedSource.blockHash || source.blockNumberAtomic !== finalizedSource.blockNumberAtomic ||
    source.receiptHash !== finalizedSource.receiptHash || source.actualFeeAtomic !== finalizedSource.actualFeeAtomic) circleFail("closure_source_finality");
}
