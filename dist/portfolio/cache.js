import { hashObject, sha256 } from "../canonical.js";
import { portfolioCacheRecord } from "./cache-record.js";
export function portfolioCacheKey(context, inventory, network, assets, account, endpoint) {
    return { family: network.family, assets, slot: hashObject({ profileHash: context.profileHash, family: network.family, chain: network.chain }),
        identity: hashObject({ profileHash: context.profileHash, profileIdentity: context.profileIdentity, dataset: inventory.dataset,
            network, assets, account, endpoint: { source: endpoint.source, env: endpoint.env,
                urlHash: endpoint.source === "env" || endpoint.source === "default_public" ? sha256(endpoint.url.href) : null } }) };
}
export async function cachedPortfolio(context, key, now) {
    if (context.refresh === true)
        return null;
    const record = await context.state.loadPortfolioCache(key.slot);
    if (record === null || record.identity !== key.identity || Date.parse(record.capturedAt) > now.getTime() || Date.parse(record.expiresAt) <= now.getTime())
        return null;
    if (record.capture.rows.length !== key.assets.length || record.capture.rows.some((row, i) => {
        const asset = key.assets[i];
        return row.kind !== asset.kind || row.contract !== asset.identifier || row.symbol !== asset.symbol || row.decimals !== asset.decimals;
    }) || (key.family === "evm" ? !record.capture.mode?.startsWith("evm_") :
        record.capture.mode !== (key.family === "solana" ? "solana_json_rpc_batch" : "tron_http_sequential")))
        return null;
    return { ...record.capture, rpcCalls: 0, attempts: 0, methods: 0, retried: [], cache: metadata(record.capture, record.capturedAt, record.expiresAt, true, now) };
}
export async function capturePortfolio(context, key, result, clock) {
    if (result.rows.some((row) => row.status !== "ok"))
        return result;
    const { mode, rpcCalls, attempts, methods, retried, block, slot, observedAt, rows } = result;
    const record = portfolioCacheRecord(key.slot, key.identity, { mode, rpcCalls, attempts, methods, retried, block, slot, observedAt, rows });
    await context.state.writePortfolioCache(record, clock);
    return { ...result, cache: metadata(record.capture, record.capturedAt, record.expiresAt, false, new Date(record.capturedAt)) };
}
function metadata(capture, capturedAt, expiresAt, hit, now) {
    return { hit, ageMs: now.getTime() - Date.parse(capturedAt), capturedAt, expiresAt,
        sourceRpc: { mode: capture.mode, rpcCalls: capture.rpcCalls, attempts: capture.attempts, methods: capture.methods, retried: capture.retried } };
}
//# sourceMappingURL=cache.js.map