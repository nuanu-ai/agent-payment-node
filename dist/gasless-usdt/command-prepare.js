import { sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { GaslessHttps } from "../gasless/https.js";
import { gaslessAddress } from "../gasless/validation.js";
import { RpcHttpFailure, RpcProviderScheduler } from "../lifi/rpc-scheduler.js";
import { StateStore } from "../state.js";
import { USDT_GASLESS } from "./model.js";
import { preparePolicyBoundUsdt } from "./policy-prepare.js";
import { usdtSafeSnapshot, usdtSponsorPort } from "./rpc.js";
import { GaslessUsdtOperationService } from "./service.js";
/** One command owns exactly nineteen RPC attempts at most: fourteen safe-chain reads and five sponsor reads. */
export class UsdtCommandReadBudget {
    state;
    transport;
    now;
    wait;
    started;
    attempts = 0;
    scheduler;
    constructor(state, transport, now = Date.now, wait = async (milliseconds) => await new Promise((resolve) => setTimeout(resolve, milliseconds))) {
        this.state = state;
        this.transport = transport;
        this.now = now;
        this.wait = wait;
        this.started = now();
        if (!Number.isFinite(this.started))
            throw new ApnError("APN_RPC_CONFIG", "Gasless USDT read clock is invalid.");
        const coordinator = { coordinate: async (family, work) => {
                const familyHash = sha256(`rpc-provider-family\0${family}`);
                await state.initialize();
                return await state.withLocks([`rpc-provider-family:${familyHash}`], async () => await work(await state.loadRpcProviderPacing(familyHash), async (value) => await state.writeRpcProviderPacing(familyHash, value), await state.loadRpcProviderCooldown(familyHash), async (value) => await state.writeRpcProviderCooldown(familyHash, value)));
            } };
        this.scheduler = new RpcProviderScheduler(coordinator, now, "reject", "transient");
    }
    count() { return this.attempts; }
    async request(endpoint, method, body, maxBytes, code) {
        this.guard(0);
        if (this.attempts >= 19)
            throw new ApnError("APN_RPC_CONFIG", "Gasless USDT read budget exhausted.", { reason: "gasless_usdt_read_budget" });
        this.attempts += 1;
        const result = await this.scheduler.schedule(endpoint, this.now, this.wait, (milliseconds) => this.guard(milliseconds), async () => {
            this.guard(0);
            const response = await this.transport.request(endpoint, method, body, maxBytes, code);
            if (response.status === 429 || response.status >= 500 && response.status <= 599) {
                throw new RpcHttpFailure("gasless_usdt_read", response.status);
            }
            return response;
        });
        this.guard(0);
        return result;
    }
    guard(waitMs) {
        const current = this.now();
        if (!Number.isFinite(current) || current < this.started || current + waitMs > this.started + 60_000) {
            throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless USDT read deadline expired.", { reason: "gasless_usdt_read_deadline" });
        }
    }
}
/** No approval, signer, reservation or dispatch port enters this service. */
export class GaslessUsdtCommandPrepare {
    state;
    clock;
    operations;
    options;
    constructor(state, clock, operations, options = {}) {
        this.state = state;
        this.clock = clock;
        this.operations = operations;
        this.options = options;
    }
    async prepare(input) {
        const profileHash = allowlistProfileHash(input.profile);
        const active = await (this.options.preparePort === undefined
            ? loadActiveAssetPolicyRegistry({ state: this.state, clock: this.clock }, input.profile)
            : this.options.preparePort.activePolicy(input.profile));
        if (active === null || active.accounts.evm === undefined) {
            throw new ApnError("APN_ALLOWLIST_REFUSED", "An active Ethereum owner asset policy is required.", { reason: "gasless_usdt_policy_required" });
        }
        const rpcUrl = this.options.rpcUrl ?? process.env.APN_ETHEREUM_RPC_URL;
        const needRpc = this.options.preparePort === undefined || this.options.sponsorPort === undefined;
        if (needRpc && (rpcUrl === undefined || rpcUrl === "")) {
            throw new ApnError("APN_RPC_CONFIG", "APN_ETHEREUM_RPC_URL is required for gasless USDT preparation.");
        }
        const budget = needRpc ? new UsdtCommandReadBudget(this.state, this.options.transport ?? new GaslessHttps(), this.options.pacingNow, this.options.wait) : undefined;
        const prepare = this.options.preparePort ?? {
            now: () => this.clock.now(),
            activePolicy: async (profile) => await loadActiveAssetPolicyRegistry({ state: this.state, clock: this.clock }, profile),
            dailyUsage: async (sender, at) => (await new AssetUsageLedger(this.state.root).usage({ account: sender,
                chain: USDT_GASLESS.chain, asset: { kind: "token", identifier: USDT_GASLESS.token } }, at)).amountAtomic,
            safeSnapshot: async (sender) => await usdtSafeSnapshot(budget, rpcUrl, sender),
        };
        const sponsor = this.options.sponsorPort ?? usdtSponsorPort(budget);
        const policy = await preparePolicyBoundUsdt({ prepare, sponsor }, { profile: input.profile,
            sender: gaslessAddress(active.accounts.evm, "APN_ALLOWLIST_REFUSED"),
            recipient: input.recipient, grossAtomic: BigInt(input.grossAtomic), maxFeeAtomic: BigInt(input.maxFeeAtomic),
            minReceivedAtomic: BigInt(input.minReceivedAtomic), chain: USDT_GASLESS.chain, token: USDT_GASLESS.token,
            sponsorUrl: USDT_GASLESS.bundlerUrl });
        return await this.operations.forProfile(profileHash).prepareBound(policy, input.idempotencyKey, prepare.now());
    }
}
//# sourceMappingURL=command-prepare.js.map