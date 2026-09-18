import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
import { sha256 } from "../canonical.js";
import { readTronAccount } from "../tron/accounts.js";
import { TRON_GENESIS, tronAddress, tronArray, tronHex, tronProtocolFailure, tronRecord, tronWord } from "../tron/codec.js";
import { assertTronNetwork, tronBlock } from "../tron/rpc.js";
import { CountingPortfolioHttp, PortfolioReadFailure, unavailableAttempt } from "./rpc-batch.js";
/**
 * TRON has no batch API: genesis identity, the solidified head (provenance anchor), `walletsolidity/getaccount`
 * for TRX and one `walletsolidity/triggerconstantcontract` `balanceOf` per listed TRC-20 token.
 */
export class TronPortfolioPort {
    http;
    family = "tron";
    constructor(http) {
        this.http = http;
    }
    async read(request) {
        const counter = new CountingPortfolioHttp(this.http);
        try {
            if (request.chain !== `tron:${TRON_GENESIS}`)
                throw new PortfolioReadFailure("protocol");
            const rpc = new PortfolioTronRpc(new URL(request.endpoint), counter), owner = tronAddress(request.account);
            await assertTronNetwork(rpc);
            const head = tronBlock(await rpc.call("walletsolidity/getnowblock", {}));
            const balances = [];
            for (const asset of request.assets) {
                const amount = asset.kind === "native" ? (await readTronAccount(rpc, owner, true)).balance
                    : await trc20Balance(rpc, tronAddress(asset.identifier), owner);
                balances.push({ ...asset, amountAtomic: amount.toString() });
            }
            return { status: "available", mode: "tron_http_sequential", calls: counter.calls, methods: counter.methods,
                block: head.number.toString(), slot: null, balances };
        }
        catch (error) {
            return unavailableAttempt(error, "tron_http_sequential", counter);
        }
    }
}
class PortfolioTronRpc {
    base;
    counter;
    originHash;
    constructor(base, counter) {
        this.base = base;
        this.counter = counter;
        this.originHash = sha256(base.origin);
    }
    async call(method, body) {
        const url = new URL(`${this.base.pathname.replace(/\/$/u, "")}/${method}`, this.base.origin);
        const raw = await this.counter.postJson(url, JSON.stringify(body), 1);
        let value;
        // POST ignores int64_as_string; lossless parsing prevents numeric rounding.
        try {
            value = tronRecord(parseJsonWithBigInts(raw));
        }
        catch {
            throw new PortfolioReadFailure("protocol");
        }
        if ("Error" in value || "error" in value)
            throw new PortfolioReadFailure("rpc_error");
        return value;
    }
}
async function trc20Balance(rpc, contract, owner) {
    const value = tronRecord(await rpc.call("walletsolidity/triggerconstantcontract", { owner_address: tronHex(contract),
        contract_address: tronHex(contract), function_selector: "balanceOf(address)", parameter: tronWord(owner), visible: false }));
    if (tronRecord(value.result).result !== true)
        tronProtocolFailure();
    const result = tronArray(value.constant_result, 1);
    if (result.length !== 1 || typeof result[0] !== "string" || !/^[a-fA-F0-9]{64}$/u.test(result[0]))
        tronProtocolFailure();
    return BigInt(`0x${result[0]}`);
}
//# sourceMappingURL=tron-reader.js.map