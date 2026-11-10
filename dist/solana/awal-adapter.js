import { NodeAwalProcessRunner } from "../awal-process-adapter.js";
import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { atomic, chainAsset, chainDisplay, SOLANA_GENESIS } from "../chain-policy.js";
import { ApnError } from "../errors.js";
import { validateRailPrepared } from "../rail-operation-model.js";
import { inspectSolana } from "./evidence.js";
import { readSolanaBalance } from "./local-adapter.js";
import { assertSolanaNetwork, solanaAddress, solanaSignature } from "./rpc.js";
export class SolanaAwalAdapter {
    storage;
    rpc;
    runner;
    fees;
    now;
    rail = "solana";
    provider = "coinbase-awal";
    execution = "provider_atomic";
    constructor(storage, rpc, runner = new NodeAwalProcessRunner(), fees, now = () => new Date()) {
        this.storage = storage;
        this.rpc = rpc;
        this.runner = runner;
        this.fees = fees;
        this.now = now;
    }
    asset(alias) { return chainAsset("solana", alias); }
    canonicalAddress(input) { return solanaAddress(input); }
    async assertNetwork() { return await assertSolanaNetwork(this.rpc); }
    async account(profile) {
        const account = await this.storage.account(profile, "solana");
        if (account !== null && account.provider !== this.provider)
            mismatch();
        return account;
    }
    async ensureAccount(profile) {
        const address = await this.providerAddress(profile);
        return await this.storage.ensureProvider({ profile, rail: "solana", provider: this.provider, address });
    }
    async balance(account, asset) {
        await this.currentAccount(account);
        await this.assertNetwork();
        const result = await this.run(["balance", "--chain", "solana", "--asset", asset.alias, "--json"], account.profile, "read");
        // Preserve only the pinned fields. Provider display strings never become amounts.
        if (result.chain !== "solana" && result.chain !== "Solana")
            providerProtocol();
        if (!isPlainRecord(result.balances))
            providerProtocol();
        const selected = result.balances[asset.symbol];
        if (!isPlainRecord(selected) || typeof selected.raw !== "string" || selected.decimals !== asset.decimals)
            providerProtocol();
        atomic(selected.raw);
        const evidence = await readSolanaBalance(this.rpc, account, asset, this.now());
        await this.currentAccount(account);
        return evidence;
    }
    async prepare(input) {
        const fees = this.feeContract();
        await this.currentAccount(input.account);
        await this.assertNetwork();
        awalAmount(input.asset, input.amountAtomic);
        const prepared = validateRailPrepared(await fees.prepare(input), input.account);
        if (prepared.networkIdentity !== SOLANA_GENESIS || prepared.unsignedPayload !== null)
            providerProtocol();
        return prepared;
    }
    async revalidate(account, prepared) {
        const fees = this.feeContract();
        await this.currentAccount(account);
        await this.assertNetwork();
        validateRailPrepared(prepared, account);
        if (this.now().getTime() >= Date.parse(prepared.expiresAt))
            throw new ApnError("APN_REPREPARE_REQUIRED", "The provider Solana approval expired.");
        awalAmount(prepared.asset, prepared.amountAtomic);
        await fees.revalidate(account, prepared);
    }
    async sign(_binding) { return unavailable(); }
    async recoverEffect(_binding) { return null; }
    async submit(binding, effect) {
        if (effect !== null)
            providerProtocol();
        await this.revalidate(binding.account, binding.prepared);
        const prepared = binding.prepared;
        const result = await this.run(["send", awalAmount(prepared.asset, prepared.amountAtomic), prepared.recipient,
            "--chain", "solana", "--asset", prepared.asset.symbol, "--json"], binding.account.profile, "send");
        if (result.chain !== "solana" && result.chain !== "Solana" || result.error !== undefined)
            providerProtocol();
        return { transactionId: solanaSignature(result.transactionHash) };
    }
    async inspect(account, prepared, transactionId) {
        // Observation of an existing effect never re-launches send or needs another fee quote.
        const stored = await this.account(account.profile);
        if (stored === null || canonicalJson(stored) !== canonicalJson(account))
            mismatch();
        validateRailPrepared(prepared, account);
        return await inspectSolana(this.rpc, account, prepared, transactionId, this.now());
    }
    async currentAccount(account) {
        const stored = await this.account(account.profile);
        if (stored === null || canonicalJson(stored) !== canonicalJson(account) || await this.providerAddress(account.profile) !== account.address)
            mismatch();
    }
    async providerAddress(profile) {
        const result = await this.run(["address", "--chain", "solana", "--json"], profile, "read");
        if (!exactKeys(result, ["address", "chain"]) || result.chain !== "solana" || typeof result.address !== "string")
            providerProtocol();
        return solanaAddress(result.address);
    }
    /** Every awal Solana call here answers JSON without secrets (address, balance, a transaction hash, and status, which also
     * names the signed-in email): the runner keeps its stdout, which is parsed once and zeroed, never logged. Authentication
     * never runs through this adapter, so no secret output can reach it. A failure is "not signed in" only on
     * awal's own word: its exact AUTH_REQUIRED answer (`address`), or, for any other exact awal failure answer (`balance`
     * answers BALANCE_FETCH_FAILED when signed out), `awal status --json` reporting `auth.authenticated: false`. The failure's
     * message text, served by awal's remote wallet window, decides nothing. Any other failure or shape stays a protocol failure.
     * `send` never asks status: a failed send keeps its own answer, since being signed out afterwards proves nothing about it. */
    async run(argv, profile, call) {
        const result = await this.runner.run(argv, false);
        const value = providerJson(result);
        if (result.exitCode === 0 && result.optionalFailure === undefined && isPlainRecord(value))
            return value;
        const failure = awalFailureCode(result.exitCode, value);
        if (failure === "AUTH_REQUIRED" || failure !== null && call === "read" && await this.signedOut())
            signInRequired(profile);
        return providerProtocol();
    }
    /** True only when awal 2.12.1 `status --json` answers exit 0 with `auth.authenticated` exactly false; a status that cannot
     * run or answers anything else leaves the original failure a protocol failure. */
    async signedOut() {
        try {
            const result = await this.runner.run(["status", "--json"], false), value = providerJson(result);
            return result.exitCode === 0 && result.optionalFailure === undefined && isPlainRecord(value) && isPlainRecord(value.auth) &&
                value.auth.authenticated === false;
        }
        catch {
            return false;
        }
    }
    feeContract() { return this.fees ?? unavailable(); }
}
export function awalAmount(asset, amountAtomic) {
    const amount = atomic(amountAtomic, true);
    if (asset.alias === "sol")
        return chainDisplay(amountAtomic, 9);
    if (asset.alias !== "usdc" || amount > BigInt(Number.MAX_SAFE_INTEGER))
        return unavailable();
    // awal 2.12.1 interprets integers >100 as atomic, other numbers as decimal USDC.
    const argument = amount > 100n ? amountAtomic : chainDisplay(amountAtomic, 6);
    const parsed = Number.parseFloat(argument);
    const observed = Number.isInteger(parsed) && parsed > 100 ? Math.floor(parsed) : Math.floor(parsed * 1_000_000);
    if (!Number.isSafeInteger(observed) || BigInt(observed) !== amount)
        return unavailable();
    return argument;
}
function unavailable() { throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "The pinned awal Solana contract does not guarantee the exact fee/rent payer and native debit cap; provider invocation is blocked."); }
function mismatch() { throw new ApnError("APN_PROFILE_DRIFT", "The authenticated Solana provider account differs from this profile."); }
function providerProtocol() { throw new ApnError("APN_PROVIDER_PROTOCOL", "The pinned awal Solana output does not attest the required public fields."); }
/** The bounded UTF-8 JSON on the provider's stdout, which is zeroed once read; anything else is a protocol failure. */
function providerJson(result) {
    try {
        if (result.stdout.length > 65_536)
            providerProtocol();
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.stdout));
    }
    catch {
        return providerProtocol();
    }
    finally {
        result.stdout.fill(0);
    }
}
/** The code of an awal 2.12.1 `cliError` answer under --json (exit 1 and exactly {"success":false,"error":{"code","message"}}). */
function awalFailureCode(exitCode, value) {
    return exitCode === 1 && isPlainRecord(value) && exactKeys(value, ["success", "error"]) && value.success === false &&
        isPlainRecord(value.error) && exactKeys(value.error, ["code", "message"]) && typeof value.error.code === "string" &&
        /^[A-Z][A-Z0-9_]{0,63}$/u.test(value.error.code) && typeof value.error.message === "string" ? value.error.code : null;
}
/** awal keeps one session for its EVM and Solana accounts; the foreground `wallet connect` handoff signs it in. */
function signInRequired(profile) {
    throw new ApnError("APN_PROVIDER_SESSION_REQUIRED", "The pinned awal wallet is not signed in.", { retryable: true, nextActions: [`apn wallet connect --profile ${profile} --provider coinbase-agentic-wallet`] });
}
//# sourceMappingURL=awal-adapter.js.map