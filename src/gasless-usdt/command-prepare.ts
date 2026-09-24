import { sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { GaslessHttps, type GaslessTransport } from "../gasless/https.js";
import { gaslessAddress } from "../gasless/validation.js";
import { RpcHttpFailure, RpcProviderScheduler, type RpcProviderPacingCoordinator } from "../lifi/rpc-scheduler.js";
import type { Address } from "../model.js";
import type { ClockPort } from "../ports.js";
import { StateStore } from "../state.js";
import type { CommandRequest } from "../commands.js";
import { USDT_GASLESS } from "./model.js";
import { preparePolicyBoundUsdt, type UsdtPreparePort } from "./policy-prepare.js";
import type { UsdtSponsorPort } from "./engine.js";
import { usdtSafeSnapshot, usdtSponsorPort } from "./rpc.js";
import { GaslessUsdtOperationService } from "./service.js";

type PrepareCommand = Extract<CommandRequest, { readonly command: "gasless.usdt.prepare" }>;
export interface UsdtCommandPrepareOptions {
  readonly transport?: GaslessTransport;
  /** Deterministic local test ports. Production reads the active policy and safe Ethereum snapshot. */
  readonly preparePort?: UsdtPreparePort;
  readonly sponsorPort?: Pick<UsdtSponsorPort, "tokenQuote" | "gasPrice" | "paymasterData">;
  readonly rpcUrl?: string;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly pacingNow?: () => number;
}

/** One command owns exactly nineteen RPC attempts at most: fourteen safe-chain reads and five sponsor reads. */
export class UsdtCommandReadBudget implements GaslessTransport {
  private readonly started: number;
  private attempts = 0;
  private readonly scheduler: RpcProviderScheduler;
  constructor(private readonly state: StateStore, private readonly transport: GaslessTransport,
    private readonly now: () => number = Date.now,
    private readonly wait: (milliseconds: number) => Promise<void> = async (milliseconds) =>
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))) {
    this.started = now();
    if (!Number.isFinite(this.started)) throw new ApnError("APN_RPC_CONFIG", "Gasless USDT read clock is invalid.");
    const coordinator: RpcProviderPacingCoordinator = { coordinate: async <T>(family: string,
      work: (lastStart: number | null, saveStart: (value: number) => Promise<void>, cooldownUntil: number | null,
        saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>) => {
      const familyHash = sha256(`rpc-provider-family\0${family}`);
      await state.initialize();
      return await state.withLocks([`rpc-provider-family:${familyHash}`], async () => await work(
        await state.loadRpcProviderPacing(familyHash), async (value: number) => await state.writeRpcProviderPacing(familyHash, value),
        await state.loadRpcProviderCooldown(familyHash), async (value: number) => await state.writeRpcProviderCooldown(familyHash, value)));
    } };
    this.scheduler = new RpcProviderScheduler(coordinator, now, "reject", "transient");
  }
  count(): number { return this.attempts; }
  async request(endpoint: string, method: "POST" | "GET", body: string | null, maxBytes: number,
    code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG") {
    this.guard(0);
    if (this.attempts >= 19) throw new ApnError("APN_RPC_CONFIG", "Gasless USDT read budget exhausted.",
      { reason: "gasless_usdt_read_budget" });
    this.attempts += 1;
    const result = await this.scheduler.schedule(endpoint, this.now, this.wait, (milliseconds) => this.guard(milliseconds), async () => {
      this.guard(0);
      const response = await this.transport.request(endpoint, method, body, maxBytes, code);
      if (response.status === 429 || response.status >= 500 && response.status <= 599) {
        throw new RpcHttpFailure("gasless_usdt_read", response.status);
      }
      return response;
    }) as Awaited<ReturnType<GaslessTransport["request"]>>;
    this.guard(0);
    return result;
  }
  private guard(waitMs: number): void {
    const current = this.now();
    if (!Number.isFinite(current) || current < this.started || current + waitMs > this.started + 60_000) {
      throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless USDT read deadline expired.",
        { reason: "gasless_usdt_read_deadline" });
    }
  }
}

/** No approval, signer, reservation or dispatch port enters this service. */
export class GaslessUsdtCommandPrepare {
  constructor(private readonly state: StateStore, private readonly clock: ClockPort,
    private readonly operations: GaslessUsdtOperationService,
    private readonly options: UsdtCommandPrepareOptions = {}) {}

  async prepare(input: PrepareCommand) {
    const profileHash = allowlistProfileHash(input.profile);
    const saved = await this.operations.forProfile(profileHash).replayBound(input.idempotencyKey, input);
    if (saved !== null) return saved;
    const active = await (this.options.preparePort === undefined
      ? loadActiveAssetPolicyRegistry({ state: this.state, clock: this.clock }, input.profile)
      : this.options.preparePort.activePolicy(input.profile));
    if (active === null || active.accounts.evm === undefined) {
      throw new ApnError("APN_ALLOWLIST_REFUSED", "An active Ethereum owner asset policy is required.",
        { reason: "gasless_usdt_policy_required" });
    }
    const rpcUrl = this.options.rpcUrl ?? process.env.APN_ETHEREUM_RPC_URL;
    const needRpc = this.options.preparePort === undefined || this.options.sponsorPort === undefined;
    if (needRpc && (rpcUrl === undefined || rpcUrl === "")) {
      throw new ApnError("APN_RPC_CONFIG", "APN_ETHEREUM_RPC_URL is required for gasless USDT preparation.");
    }
    const budget = needRpc ? new UsdtCommandReadBudget(this.state, this.options.transport ?? new GaslessHttps(),
      this.options.pacingNow, this.options.wait) : undefined;
    const prepare: UsdtPreparePort = this.options.preparePort ?? {
      now: () => this.clock.now(),
      activePolicy: async (profile) => await loadActiveAssetPolicyRegistry({ state: this.state, clock: this.clock }, profile),
      dailyUsage: async (sender: Address, at: Date) => (await new AssetUsageLedger(this.state.root).usage({ account: sender,
        chain: USDT_GASLESS.chain, asset: { kind: "token", identifier: USDT_GASLESS.token } }, at)).amountAtomic,
      safeSnapshot: async (sender: Address) => await usdtSafeSnapshot(budget!, rpcUrl!, sender),
    };
    const sponsor = this.options.sponsorPort ?? usdtSponsorPort(budget!);
    const policy = await preparePolicyBoundUsdt({ prepare, sponsor }, { profile: input.profile,
      sender: gaslessAddress(active.accounts.evm, "APN_ALLOWLIST_REFUSED"),
      recipient: input.recipient, grossAtomic: BigInt(input.grossAtomic), maxFeeAtomic: BigInt(input.maxFeeAtomic),
      minReceivedAtomic: BigInt(input.minReceivedAtomic), chain: USDT_GASLESS.chain, token: USDT_GASLESS.token,
      sponsorUrl: USDT_GASLESS.bundlerUrl });
    return await this.operations.forProfile(profileHash).prepareBound(policy, input.idempotencyKey, prepare.now());
  }
}
