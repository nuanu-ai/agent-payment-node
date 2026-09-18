import { address } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SOLANA_GENESIS } from "../chain-policy.js";
import { multipleAccounts, requireNativeAccount, tokenAccountAmount } from "../solana/accounts.js";
import { solanaAddress } from "../solana/rpc.js";
import { CountingPortfolioHttp, jsonRpcBatchBody, jsonRpcBatchResults, PortfolioReadFailure, unavailableAttempt } from "./rpc-batch.js";
/**
 * One HTTP request: a JSON-RPC batch of `getGenesisHash` and one `getMultipleAccounts` for the owner plus the
 * associated token account of every listed mint. Tokens held outside the associated account are not counted.
 */
export class SolanaPortfolioPort {
    http;
    family = "solana";
    constructor(http) {
        this.http = http;
    }
    async read(request) {
        const counter = new CountingPortfolioHttp(this.http);
        try {
            if (request.chain !== `solana:${SOLANA_GENESIS}`)
                throw new PortfolioReadFailure("protocol");
            const owner = solanaAddress(request.account);
            const mints = request.assets.map((asset) => asset.kind === "token" ? solanaAddress(asset.identifier) : null);
            const accounts = [owner, ...await Promise.all(mints.filter((mint) => mint !== null).map(async (mint) => (await findAssociatedTokenPda({ owner: address(owner), mint: address(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]))];
            const raw = await counter.postJson(new URL(request.endpoint), jsonRpcBatchBody([
                { method: "getGenesisHash", params: [] },
                { method: "getMultipleAccounts", params: [accounts, { encoding: "base64", commitment: "confirmed" }] },
            ]), 2);
            const [genesis, multiple] = jsonRpcBatchResults(raw, 2, true);
            if (!genesis.ok || !multiple.ok)
                throw new PortfolioReadFailure("rpc_error");
            if (genesis.value !== SOLANA_GENESIS)
                throw new PortfolioReadFailure("chain_mismatch");
            const read = multipleAccounts(multiple.value, accounts.length);
            let tokenIndex = 0;
            const balances = request.assets.map((asset, index) => {
                const mint = mints[index];
                const info = mint === null || mint === undefined ? read.accounts[0] : read.accounts[++tokenIndex];
                try {
                    const amount = mint === null || mint === undefined ? requireNativeAccount(info) : tokenAccountAmount(info, owner, mint);
                    return { ...asset, amountAtomic: amount.toString() };
                }
                catch {
                    return { ...asset, unavailable: "protocol" };
                }
            });
            return { status: "available", mode: "solana_json_rpc_batch", calls: counter.calls, methods: counter.methods,
                block: null, slot: read.slot.toString(), balances };
        }
        catch (error) {
            return unavailableAttempt(error, "solana_json_rpc_batch", counter);
        }
    }
}
//# sourceMappingURL=solana-reader.js.map