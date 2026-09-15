import { canonicalJson, exactKeys, sha256 } from "../../canonical.js";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { parsePublicHttpsUrl } from "../../network-policy.js";
import type { ClockPort } from "../../ports.js";
import { parseJsonWithDuplicateRejection } from "../../x402-strict-json.js";
import { GaslessHttps, type GaslessTransport } from "../../gasless/https.js";
import type { SmartAccountGaslessBinding, SmartAccountGaslessBlock, SmartAccountGaslessMaterialDescriptor,
  SmartAccountGaslessSnapshot } from "../model.js";
import type { SmartAccountGaslessMaterialValidatorPort, SmartAccountGaslessObservationRpcFactory, SmartAccountGaslessRpcFactory,
  SmartAccountGaslessRpcPort, SmartAccountGaslessObserveInput } from "../ports.js";
import { saFail } from "../reasons.js";
import { saRegistry } from "../registry.js";
import { saBinding, saBlock, saExact, saHash, saHex, saIso,
  validateSmartAccountGaslessIntent } from "../schema.js";
import { saSame } from "../integrity.js";
import { captureSmartAccountGaslessSnapshot, recheckSmartAccountPreparation } from "./snapshot.js";
import { readChildSpent } from "./allowance.js";
import { observeSmartAccountGasless, validateSmartAccountGaslessObserveInput } from "./observation.js";
import { SaRpcBudgetError, SaRpcRangeError, recheckBlock, rpcQuantity, rpcRecord,
  type SaRpcCall, type SaRpcMethod } from "./abi.js";

const READ_METHODS = new Set<SaRpcMethod>(["eth_chainId", "eth_getBlockByNumber", "eth_getCode",
  "eth_getStorageAt", "eth_call", "eth_getBalance", "eth_getTransactionByHash", "eth_getTransactionReceipt",
  "eth_getLogs"]);
const MAX_RESPONSE = 4 * 1024 * 1024;
const PASS_START_BUDGET_MS = 45_000;
const CALL_ACTIVE_MS = 15_000;
const REQUEST_START_INTERVAL_MS = 1_000;

export interface SmartAccountGaslessRpcPacing {
  readonly minimumIntervalMs: number;
  monotonicNow(): number;
  sleep(milliseconds: number): Promise<void>;
}

const defaultPacing = (): SmartAccountGaslessRpcPacing => ({
  minimumIntervalMs: REQUEST_START_INTERVAL_MS,
  monotonicNow: () => performance.now(),
  sleep: async milliseconds => { await sleep(milliseconds); },
});

export interface SmartAccountGaslessRpcOptions {
  readonly chainId: 8453;
  readonly rpcUrl: string;
  readonly clock: ClockPort;
  readonly validator: SmartAccountGaslessMaterialValidatorPort;
  readonly transport?: GaslessTransport;
  readonly pacing?: SmartAccountGaslessRpcPacing;
  /** Observe saved operations only: prove the chain and the frozen anchor instead of the frozen endpoint identity. */
  readonly observationOnly?: boolean;
}

interface SmartAccountGaslessRpcPass {
  readonly startedAt: number;
  calls: number;
  failure: unknown | null;
}

/** Lazy binding performs no RPC, custody, provider or chain effect. */
export function smartAccountGaslessRpcFactory(environment: Readonly<Record<string, string | undefined>>,
  clock: ClockPort, validator: SmartAccountGaslessMaterialValidatorPort,
  transport?: GaslessTransport): SmartAccountGaslessRpcFactory {
  let cached: SmartAccountGaslessRpcPort | undefined;
  return chainId => {
    if (chainId !== 8453) saFail("sa_gasless_capability");
    if (cached !== undefined) return cached;
    const rpcUrl = environment[saRegistry(chainId).rpcEnv];
    if (rpcUrl === undefined || rpcUrl.length === 0) saFail("sa_gasless_rpc_binding");
    cached = new SmartAccountGaslessRpc({ chainId, rpcUrl, clock, validator, ...(transport === undefined ? {} : { transport }) });
    return cached;
  };
}

/** An owner-named RPC that observes saved operations only; it never serves pre-exposure snapshots or spent checks. */
export function smartAccountGaslessObservationRpcFactory(environment: Readonly<Record<string, string | undefined>>,
  clock: ClockPort, validator: SmartAccountGaslessMaterialValidatorPort,
  transport?: GaslessTransport): SmartAccountGaslessObservationRpcFactory {
  return (chainId, environmentName) => {
    if (chainId !== 8453) saFail("sa_gasless_capability");
    const rpcUrl = environment[saObservationRpcEnv(environmentName)];
    if (rpcUrl === undefined || rpcUrl.length === 0) saFail("sa_gasless_rpc_binding");
    return new SmartAccountGaslessRpc({ chainId, rpcUrl, clock, validator, observationOnly: true,
      ...(transport === undefined ? {} : { transport }) });
  };
}

export function saObservationRpcEnv(value: unknown): string {
  if (typeof value !== "string" || value.length > 128 || !/^APN_[A-Z0-9_]+_RPC_URL$/u.test(value)) saFail("sa_gasless_input");
  return value as string;
}

export class SmartAccountGaslessRpc implements SmartAccountGaslessRpcPort {
  readonly chainId = 8453 as const;
  readonly endpointOrigin: string;
  readonly endpointHash: string;
  readonly rpcUrl: string;
  private readonly clock: ClockPort;
  private readonly validator: SmartAccountGaslessMaterialValidatorPort;
  private readonly transport: GaslessTransport;
  private readonly observationOnly: boolean;
  private readonly pacing: SmartAccountGaslessRpcPacing;
  private sequence = 0n;
  private queue: Promise<void> = Promise.resolve();
  private lastRequestStartedAt: number | null = null;

  constructor(options: SmartAccountGaslessRpcOptions) {
    if (options.chainId !== 8453) saFail("sa_gasless_rpc_binding");
    const endpoint = rpcEndpoint(options.rpcUrl);
    this.rpcUrl = endpoint.toString(); this.endpointOrigin = endpoint.origin;
    this.endpointHash = sha256(this.rpcUrl); this.clock = options.clock; this.validator = options.validator;
    this.transport = options.transport ?? new GaslessHttps(); this.pacing = options.pacing ?? defaultPacing();
    this.observationOnly = options.observationOnly === true;
  }

  async snapshot(binding: SmartAccountGaslessBinding,
    expectedPreparationBlock?: SmartAccountGaslessBlock): Promise<SmartAccountGaslessSnapshot> {
    if (this.observationOnly) saFail("sa_gasless_rpc_binding");
    const call = this.pass();
    await this.assertChain(call);
    const snapshot = await captureSmartAccountGaslessSnapshot(call, this.chainId, this.endpointOrigin,
      this.endpointHash, this.clock, binding);
    if (expectedPreparationBlock !== undefined) {
      await recheckSmartAccountPreparation(call, expectedPreparationBlock, snapshot.preparationBlock);
    }
    return snapshot;
  }

  async assertUnspent(input: { readonly binding: SmartAccountGaslessBinding;
    readonly material: SmartAccountGaslessMaterialDescriptor;
    readonly safeBlock: SmartAccountGaslessBlock }): Promise<void> {
    if (this.observationOnly) saFail("sa_gasless_rpc_binding");
    const call = this.pass(), binding = saBinding(input.binding), safeBlock = saBlock(input.safeBlock);
    const material = saExact(input.material, ["encodedRootHash", "encodedChildHash", "permissionContextHash",
      "payloadHash", "requirementsHash", "materialHash", "rootDelegationHash", "childDelegationHash", "sealedAt"]);
    for (const name of ["encodedRootHash", "encodedChildHash", "permissionContextHash", "payloadHash",
      "requirementsHash", "materialHash"] as const) saHash(material[name]);
    saHex(material.rootDelegationHash, 32); const childHash = saHex(material.childDelegationHash, 32);
    saIso(material.sealedAt);
    if (material.encodedRootHash !== binding.encodedRootHash ||
      material.rootDelegationHash !== binding.rootDelegationHash) saFail("sa_gasless_evidence");
    await this.assertChain(call);
    if (await readChildSpent(call, binding.delegationManager, childHash, safeBlock) !== "0") {
      saFail("sa_gasless_evidence");
    }
    await recheckBlock(call, safeBlock);
  }

  async observe(input: SmartAccountGaslessObserveInput) {
    this.assertInput(input);
    const call = this.pass();
    try {
      await this.assertChain(call);
      // Another provider must first prove the same chain history at the operation's frozen safe anchor.
      if (this.observationOnly) await recheckBlock(call, input.intent.initialSnapshot.safeBlock, "sa_gasless_rpc_binding");
      return await observeSmartAccountGasless({ call, clock: this.clock, validator: this.validator }, input);
    } catch (error) {
      if (error instanceof SaRpcBudgetError) {
        return { cursor: input.cursor, observation: { observedAt: instant(this.clock), phase: "pending" as const,
          reason: "sa_gasless_partial" as const, candidateTxHash: null, evidenceHash: null },
          settlement: null, unusedProof: null };
      }
      throw error;
    }
  }

  private assertInput(input: SmartAccountGaslessObserveInput): void {
    validateSmartAccountGaslessObserveInput(input);
    const intent = validateSmartAccountGaslessIntent(input.intent), registry = saRegistry(8453);
    if (!saSame(intent, input.intent) || (!this.observationOnly && (intent.initialSnapshot.endpointHash !== this.endpointHash ||
      intent.initialSnapshot.endpointOrigin !== this.endpointOrigin)) || intent.deploymentEvidenceHash !== registry.evidenceHash ||
      intent.token !== registry.token.address) saFail("sa_gasless_rpc_binding");
  }

  private async assertChain(call: SaRpcCall): Promise<void> {
    if (rpcQuantity(await call("eth_chainId", [])) !== 8453n) saFail("sa_gasless_rpc_binding");
  }

  private pass(): SaRpcCall {
    const attempt: SmartAccountGaslessRpcPass = { startedAt: this.pacing.monotonicNow(), calls: 0, failure: null };
    return async (method, params) => {
      const elapsed = this.pacing.monotonicNow() - attempt.startedAt;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= PASS_START_BUDGET_MS || attempt.calls >= 64) {
        const failure = new SaRpcBudgetError(); attempt.failure = failure; throw failure;
      }
      attempt.calls += 1;
      return await this.call(method, params, attempt);
    };
  }

  private async call(method: SaRpcMethod, params: readonly unknown[], attempt: SmartAccountGaslessRpcPass): Promise<unknown> {
    if (!READ_METHODS.has(method)) saFail("sa_gasless_evidence");
    const id = (++this.sequence).toString(), body = canonicalJson({ jsonrpc: "2.0", id, method, params });
    return await this.schedule(attempt, async () => await this.performCall(method, body, id));
  }

  private async performCall(method: SaRpcMethod, body: string, id: string): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: { readonly status: number; readonly body: string };
    try {
      response = await Promise.race([
        this.transport.request(this.rpcUrl, "POST", body, MAX_RESPONSE, "APN_RPC_CONFIG"),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("rpc deadline")), CALL_ACTIVE_MS);
        }),
      ]);
    } catch { return saFail("sa_gasless_rpc_unavailable"); }
    finally { clearTimeout(timer); }
    if (response.status !== 200 || Buffer.byteLength(response.body, "utf8") > MAX_RESPONSE) {
      if (method === "eth_getLogs") throw new SaRpcRangeError();
      saFail("sa_gasless_rpc_unavailable");
    }
    let parsed: unknown;
    try { parsed = parseJsonWithDuplicateRejection(response.body); }
    catch { return saFail("sa_gasless_evidence"); }
    const record = rpcRecord(parsed), hasResult = Object.hasOwn(record, "result"), hasError = Object.hasOwn(record, "error");
    const keys = hasResult ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"];
    if (record.jsonrpc !== "2.0" || record.id !== id || hasResult === hasError || !exactKeys(record, keys)) {
      saFail("sa_gasless_evidence");
    }
    if (hasError) {
      if (method === "eth_getLogs") throw new SaRpcRangeError();
      saFail("sa_gasless_rpc_unavailable");
    }
    return record.result;
  }

  private async schedule<T>(attempt: SmartAccountGaslessRpcPass, work: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(async () => {
      if (attempt.failure !== null) throw attempt.failure;
      if (this.lastRequestStartedAt !== null) {
        const remaining = this.pacing.minimumIntervalMs -
          (this.pacing.monotonicNow() - this.lastRequestStartedAt);
        if (remaining > 0) await this.pacing.sleep(remaining);
      }
      const started = this.pacing.monotonicNow(), elapsed = started - attempt.startedAt;
      if (!Number.isFinite(started) || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= PASS_START_BUDGET_MS) {
        const failure = new SaRpcBudgetError(); attempt.failure = failure; throw failure;
      }
      if (attempt.failure !== null) throw attempt.failure;
      this.lastRequestStartedAt = started;
      try { return await work(); }
      catch (error) {
        // Range rejection is a bounded scan control signal; it may retry a smaller range in this same pass.
        if (!(error instanceof SaRpcRangeError)) attempt.failure = error;
        throw error;
      }
    });
    this.queue = pending.then(() => undefined, () => undefined);
    return await pending;
  }
}

function rpcEndpoint(value: string): URL {
  try { return parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Smart Account gasless RPC endpoint", 2048); }
  catch { return saFail("sa_gasless_rpc_binding"); }
}
function instant(clock: ClockPort): string {
  const value = clock.now();
  if (!Number.isFinite(value.getTime())) saFail("sa_gasless_internal");
  return value.toISOString();
}
