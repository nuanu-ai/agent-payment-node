import type { HttpGetRequest, HttpObservation, HttpPort } from "../../src/x402-model.js";
import type { Address, Hex } from "../../src/model.js";
import type {
  NativePort,
  NativeRequest,
  X402AuthorizationState,
  X402AuthorizationUsedLogs,
  X402BlockReference,
  X402RpcBlock,
  X402RpcHead,
  X402RpcLog,
  X402RpcPort,
  X402RpcReceipt,
} from "../../src/ports.js";
import { domainHash } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { privateKeyToAccount } from "viem/accounts";
import { TestRpc } from "./helpers.js";
import { canonicalPaymentRequiredHeader, X402_URL } from "./x402-vectors.js";

const PRIVATE_KEY = `0x${"0".repeat(63)}1` as Hex;
export const X402_TEST_ACCOUNT = privateKeyToAccount(PRIVATE_KEY);

export class TestHttp implements HttpPort {
  readonly calls: HttpGetRequest[] = [];
  response: HttpObservation;

  constructor(response: HttpObservation = challengeObservation()) {
    this.response = response;
  }

  async get(request: HttpGetRequest): Promise<HttpObservation> {
    this.calls.push(request);
    return this.response;
  }
}

export class QueuedHttp implements HttpPort {
  readonly calls: HttpGetRequest[] = [];
  readonly outcomes: Array<HttpObservation | Error>;
  readonly onCall?: (request: HttpGetRequest, callNumber: number) => void | Promise<void>;

  constructor(
    outcomes: readonly (HttpObservation | Error)[],
    onCall?: (request: HttpGetRequest, callNumber: number) => void | Promise<void>,
  ) {
    this.outcomes = [...outcomes];
    if (onCall !== undefined) this.onCall = onCall;
  }

  async get(request: HttpGetRequest): Promise<HttpObservation> {
    this.calls.push(request);
    await this.onCall?.(request, this.calls.length);
    const outcome = this.outcomes.shift();
    if (outcome === undefined) throw new Error("unexpected x402 HTTP call");
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

export class ExactX402Native implements NativePort {
  readonly calls: NativeRequest[] = [];
  material: Readonly<Record<string, unknown>> | undefined;

  async request(request: NativeRequest): Promise<unknown> {
    this.calls.push(request);
    if (request.operation === "wallet.ensure") {
      return {
        profile: request.payload.profile,
        address: X402_TEST_ACCOUNT.address,
        createdAt: "2026-08-25T00:00:00.000Z",
        bindingHash: "a".repeat(64),
      };
    }
    if (request.operation === "x402Exact.authorizationMaterial.get") {
      if (this.material === undefined) {
        throw new ApnError("APN_NATIVE_REJECTED", "Native material is absent.", {
          nativeCode: "APN_X402_AUTHORIZATION_NOT_FOUND",
        });
      }
      return this.material;
    }
    if (request.operation !== "x402Exact.approveAndAuthorize") throw new Error(`unexpected native operation ${request.operation}`);
    const payload = request.payload as {
      readonly token: `0x${string}`;
      readonly tokenDomain: { readonly name: string; readonly version: string };
      readonly authorization: {
        readonly from: `0x${string}`; readonly to: `0x${string}`; readonly value: string;
        readonly validAfter: "0"; readonly validBefore: string; readonly nonce: `0x${string}`;
      };
    };
    const signature = await X402_TEST_ACCOUNT.signTypedData({
      domain: {
        name: payload.tokenDomain.name,
        version: payload.tokenDomain.version,
        chainId: 8453,
        verifyingContract: payload.token,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" }, { name: "to", type: "address" },
          { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: payload.authorization.from,
        to: payload.authorization.to,
        value: BigInt(payload.authorization.value),
        validAfter: 0n,
        validBefore: BigInt(payload.authorization.validBefore),
        nonce: payload.authorization.nonce,
      },
    });
    this.material = {
      authorization: {
        from: payload.authorization.from,
        to: payload.authorization.to,
        value: payload.authorization.value,
        validAfter: payload.authorization.validAfter,
        validBefore: payload.authorization.validBefore,
        nonce: payload.authorization.nonce,
      },
      signature,
      signatureHash: domainHash("apn.x402.signature.v1", Buffer.from(signature.slice(2), "hex")),
    };
    return this.material;
  }
}

export class RecoveryRpc extends TestRpc implements X402RpcPort {
  readonly x402Calls: string[] = [];
  safeHead: X402RpcHead = {
    queriedTag: "safe",
    number: "12345",
    hash: `0x${"b".repeat(64)}`,
    timestamp: "1787702400",
    observedAt: "2026-08-26T00:00:00.000Z",
    rpcOrigin: this.rpcOrigin,
  };
  finalizedHead: X402RpcHead = {
    queriedTag: "finalized",
    number: "12344",
    hash: `0x${"a".repeat(64)}`,
    timestamp: "1787702390",
    observedAt: "2026-08-26T00:00:00.000Z",
    rpcOrigin: this.rpcOrigin,
  };
  x402Receipt: X402RpcReceipt | null = null;
  authorizationStateValue = false;
  logOutcomes: X402AuthorizationUsedLogs[] = [];
  blockHashes = new Map<string, Hex>();
  blockTimestamps = new Map<string, string>();
  onX402Call?: (name: string) => void | Promise<void>;

  withTotalTimeout(_milliseconds: number): X402RpcPort { return this; }

  override async assertBaseChain(): Promise<{ readonly chainId: 8453; readonly rpcOrigin: string }> {
    this.x402Calls.push("chain");
    await this.onX402Call?.("chain");
    return await super.assertBaseChain();
  }

  async getX402Head(tag: "safe" | "finalized"): Promise<X402RpcHead> {
    this.x402Calls.push(tag);
    await this.onX402Call?.(tag);
    const head = tag === "safe" ? this.safeHead : this.finalizedHead;
    return { ...head };
  }

  async getX402Block(number: string): Promise<X402RpcBlock> {
    this.x402Calls.push(`block:${number}`);
    await this.onX402Call?.(`block:${number}`);
    const isSafe = number === this.safeHead.number;
    const isFinalized = number === this.finalizedHead.number;
    return {
      queriedTag: "number",
      number,
      hash: this.blockHashes.get(number) ?? (isSafe
        ? this.safeHead.hash
        : isFinalized ? this.finalizedHead.hash : `0x${"d".repeat(64)}`),
      timestamp: this.blockTimestamps.get(number) ?? (isSafe
        ? this.safeHead.timestamp
        : isFinalized ? this.finalizedHead.timestamp : (BigInt(this.safeHead.timestamp) - 1n).toString()),
      observedAt: this.safeHead.observedAt,
      rpcOrigin: this.rpcOrigin,
    };
  }

  async getX402Receipt(_transactionHash: Hex): Promise<X402RpcReceipt | null> {
    this.x402Calls.push("receipt");
    await this.onX402Call?.("receipt");
    return this.x402Receipt === null ? null : { ...this.x402Receipt, logs: [...this.x402Receipt.logs] };
  }

  async getX402AuthorizationState(
    _authorizer: Address,
    _nonce: Hex,
    block: X402BlockReference,
  ): Promise<X402AuthorizationState> {
    const label = "tag" in block ? `state:${block.tag}` : `state:${block.number}`;
    this.x402Calls.push(label);
    await this.onX402Call?.(label);
    const identity = "tag" in block
      ? block.tag === "safe" ? this.safeHead : this.finalizedHead
      : await this.getX402Block(block.number);
    return {
      value: this.authorizationStateValue,
      blockNumber: identity.number,
      blockHash: identity.hash,
      blockTag: "tag" in block ? block.tag : "number",
      observedAt: identity.observedAt,
      rpcOrigin: this.rpcOrigin,
    };
  }

  async getX402AuthorizationUsedLogs(input: {
    readonly authorizer: Address; readonly nonce: Hex; readonly fromBlock: string; readonly toBlock: string;
  }): Promise<X402AuthorizationUsedLogs> {
    this.x402Calls.push(`logs:${input.fromBlock}-${input.toBlock}`);
    await this.onX402Call?.(`logs:${input.fromBlock}-${input.toBlock}`);
    return this.logOutcomes.shift() ?? { kind: "complete", logs: [] };
  }

  async getX402TransferLogs(): Promise<{ readonly kind: "complete"; readonly logs: readonly X402RpcLog[] }> {
    return { kind: "complete", logs: [] };
  }
}

export function authorizationUsedLog(input: {
  readonly authorizer: Address; readonly nonce: Hex; readonly transactionHash: Hex;
  readonly blockNumber: string; readonly blockHash: Hex; readonly logIndex?: string;
}): X402RpcLog {
  return {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase() as Address,
    topics: [
      "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5",
      `0x${input.authorizer.slice(2).toLowerCase().padStart(64, "0")}` as Hex,
      input.nonce,
    ],
    data: "0x",
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    transactionHash: input.transactionHash,
    logIndex: input.logIndex ?? "0",
  };
}

export function transferLog(input: {
  readonly from: Address; readonly to: Address; readonly value: string; readonly transactionHash: Hex;
  readonly blockNumber: string; readonly blockHash: Hex; readonly logIndex?: string;
}): X402RpcLog {
  return {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase() as Address,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      `0x${input.from.slice(2).toLowerCase().padStart(64, "0")}` as Hex,
      `0x${input.to.slice(2).toLowerCase().padStart(64, "0")}` as Hex,
    ],
    data: `0x${BigInt(input.value).toString(16).padStart(64, "0")}` as Hex,
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    transactionHash: input.transactionHash,
    logIndex: input.logIndex ?? "1",
  };
}

export function challengeObservation(input: {
  readonly header?: string;
  readonly rawHeaderPairs?: readonly (readonly [string, string])[];
  readonly status?: number;
  readonly finalUrl?: string;
} = {}): HttpObservation {
  const finalUrl = input.finalUrl ?? X402_URL;
  return {
    status: input.status ?? 402,
    rawHeaderPairs: input.rawHeaderPairs ?? [["PAYMENT-REQUIRED", input.header ?? canonicalPaymentRequiredHeader()]],
    bodyBytes: new Uint8Array(),
    finalUrl,
    observedOrigin: new URL(finalUrl).origin,
    dnsAddresses: ["1.1.1.1"],
    selectedAddress: "1.1.1.1",
    startedAt: "2026-08-27T00:00:00.000Z",
    observedAt: "2026-08-27T00:00:00.001Z",
    safeTransportProvenance: {
      protocol: "https",
      tlsAuthorized: true,
      redirectCount: 0,
    },
  };
}

export function paidObservation(input: {
  readonly paymentResponseHeader?: string;
  readonly paymentResponseHeaderName?: "PAYMENT-RESPONSE" | "X-PAYMENT-RESPONSE";
  readonly paymentRequiredHeader?: string;
  readonly status?: number;
  readonly bodyText?: string;
  readonly mediaType?: string;
  readonly rawHeaderPairs?: readonly (readonly [string, string])[];
  readonly finalUrl?: string;
  readonly startedAt?: string;
  readonly observedAt?: string;
} = {}): HttpObservation {
  const finalUrl = input.finalUrl ?? X402_URL;
  const status = input.status ?? 200;
  const bodyText = input.bodyText ?? '{"forecast":"sunny"}';
  const bodyBytes = Buffer.from(bodyText, "utf8");
  const rawHeaderPairs = input.rawHeaderPairs ?? [
    ["Content-Type", input.mediaType ?? "application/json"],
    ["Content-Length", bodyBytes.byteLength.toString()],
    ...(input.paymentResponseHeader === undefined ? [] : [[
      input.paymentResponseHeaderName ?? "PAYMENT-RESPONSE",
      input.paymentResponseHeader,
    ] as const]),
    ...(input.paymentRequiredHeader === undefined ? [] : [["PAYMENT-REQUIRED", input.paymentRequiredHeader] as const]),
  ];
  return {
    status,
    rawHeaderPairs,
    bodyBytes,
    finalUrl,
    observedOrigin: new URL(finalUrl).origin,
    dnsAddresses: ["1.1.1.1"],
    selectedAddress: "1.1.1.1",
    startedAt: input.startedAt ?? "2026-08-26T00:00:00.010Z",
    observedAt: input.observedAt ?? "2026-08-26T00:00:00.020Z",
    safeTransportProvenance: {
      protocol: "https",
      tlsAuthorized: true,
      redirectCount: 0,
    },
  };
}
