import { canonicalJson, domainHash, isPlainRecord } from "../canonical.js";
import { GaslessHttps, type GaslessTransport } from "../gasless/https.js";
import type { Address, Hex } from "../model.js";
import { parseJsonWithDuplicateRejection } from "../x402-strict-json.js";
import { facilitatorFail } from "./failure.js";
import { AVALANCHE_FACILITATOR as R } from "./registry.js";
import type { FacilitatorAuthorization, FacilitatorRequirement } from "./requirement.js";

const MAX_RESPONSE = 256 * 1024;
const MAX_BODY = 64 * 1024;
const SUPPORT_DOMAIN = "apn.facilitator-gasless.supported.v1";
const VERIFY_DOMAIN = "apn.facilitator-gasless.verify.v1";
const SETTLE_DOMAIN = "apn.facilitator-gasless.settle.v1";

export interface FacilitatorPayment {
  readonly requirement: FacilitatorRequirement;
  readonly authorization: FacilitatorAuthorization;
  readonly signature: Hex;
}
export interface FacilitatorSupport {
  readonly endpointOrigin: string;
  readonly endpointHash: string;
  readonly signers: readonly Address[];
  readonly supportedResponseHash: string;
  readonly observedAt: string;
}
export interface FacilitatorVerification { readonly observedAt: string; readonly payer: Address; readonly responseHash: string }
export interface FacilitatorSettlement {
  readonly observedAt: string;
  readonly transactionHash: Hex | null;
  readonly pending: boolean;
  readonly responseHash: string;
}
export interface FacilitatorPort {
  supported(): Promise<FacilitatorSupport>;
  verify(payment: FacilitatorPayment): Promise<FacilitatorVerification>;
  settle(payment: FacilitatorPayment): Promise<FacilitatorSettlement>;
}

/** Exactly one transport call per method; the lifecycle owns every durable marker around it. */
export class PayAiFacilitator implements FacilitatorPort {
  constructor(private readonly transport: GaslessTransport = new GaslessHttps(), private readonly now: () => Date = () => new Date()) {}

  async supported(): Promise<FacilitatorSupport> {
    const value = parse(await this.call("supported", null));
    if (!isPlainRecord(value) || !Array.isArray(value.kinds) || !isPlainRecord(value.signers)) facilitatorFail("facilitator_gasless_provider_protocol");
    const kind = value.kinds.some(row => isPlainRecord(row) && row.x402Version === 2 && row.scheme === "exact" && row.network === R.network);
    if (!kind) facilitatorFail("facilitator_gasless_capability");
    const listed = [...signerList(value.signers["eip155:*"]), ...signerList(value.signers[R.network])];
    const signers = R.approvedSigners.filter(signer => listed.includes(signer));
    if (signers.length === 0) facilitatorFail("facilitator_gasless_capability");
    return { endpointOrigin: R.facilitatorOrigin, endpointHash: R.facilitatorEndpointHash, signers,
      supportedResponseHash: domainHash(SUPPORT_DOMAIN, canonicalJson(value)), observedAt: instant(this.now()) };
  }

  async verify(payment: FacilitatorPayment): Promise<FacilitatorVerification> {
    const value = parse(await this.call("verify", body(payment)));
    if (!isPlainRecord(value) || typeof value.isValid !== "boolean") facilitatorFail("facilitator_gasless_provider_protocol");
    if (value.isValid !== true || address(value.payer) !== payment.authorization.from) facilitatorFail("facilitator_gasless_verify_rejected");
    return { observedAt: instant(this.now()), payer: payment.authorization.from, responseHash: domainHash(VERIFY_DOMAIN, canonicalJson(value)) };
  }

  async settle(payment: FacilitatorPayment): Promise<FacilitatorSettlement> {
    const value = parse(await this.call("settle", body(payment)));
    if (!isPlainRecord(value) || typeof value.success !== "boolean") facilitatorFail("facilitator_gasless_provider_protocol");
    const transactionHash = typeof value.transaction === "string" && /^0x[0-9a-fA-F]{64}$/u.test(value.transaction)
      ? value.transaction.toLowerCase() as Hex : null;
    if ((value.network !== undefined && value.network !== R.network) ||
      (value.payer !== undefined && address(value.payer) !== payment.authorization.from)) facilitatorFail("facilitator_gasless_provider_protocol");
    const pending = value.success !== true && value.errorReason === "settlement_pending" && transactionHash !== null;
    if (value.success !== true && !pending) facilitatorFail("facilitator_gasless_settle_unknown");
    if (value.success === true && transactionHash === null) facilitatorFail("facilitator_gasless_provider_protocol");
    return { observedAt: instant(this.now()), transactionHash, pending, responseHash: domainHash(SETTLE_DOMAIN, canonicalJson(value)) };
  }

  private async call(path: "supported" | "verify" | "settle", payload: string | null): Promise<string> {
    if (payload !== null && Buffer.byteLength(payload, "utf8") > MAX_BODY) facilitatorFail("facilitator_gasless_provider_protocol");
    let response;
    try {
      response = await this.transport.request(`${R.facilitatorUrl}/${path}`, payload === null ? "GET" : "POST", payload, MAX_RESPONSE, "APN_HTTP_CONFIG");
    } catch { return facilitatorFail("facilitator_gasless_provider_unavailable"); }
    if (response.status !== 200) facilitatorFail("facilitator_gasless_provider_unavailable");
    return response.body;
  }
}

/** `resource` is omitted: the requirement is APN's own, not a seller offer. */
function body(payment: FacilitatorPayment): string {
  return canonicalJson({ x402Version: 2, paymentRequirements: payment.requirement, paymentPayload: {
    x402Version: 2, accepted: payment.requirement, payload: { signature: payment.signature, authorization: payment.authorization } } });
}
function signerList(value: unknown): readonly Address[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(item => item.toLowerCase() as Address) : [];
}
function address(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) facilitatorFail("facilitator_gasless_provider_protocol");
  return value.toLowerCase() as Address;
}
function parse(text: string): unknown {
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE) facilitatorFail("facilitator_gasless_provider_protocol");
  try { return parseJsonWithDuplicateRejection(text); } catch { return facilitatorFail("facilitator_gasless_provider_protocol"); }
}
function instant(value: Date): string {
  if (!Number.isFinite(value.getTime())) facilitatorFail("facilitator_gasless_state_corrupt");
  return value.toISOString();
}
