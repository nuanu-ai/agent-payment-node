import { ApnError } from "../../errors.js";
// Finite source-reviewed public configuration. These identities never come from
// a quote, builder, environment override, policy file or caller-selected address.
export const REVIEWED_WHIRLPOOL_V2_POOLS = Object.freeze([
    Object.freeze({ pool: "Esvfxt3jMDdtTZqLF1fqRhDjzM8Bpr7fZxJMrK69PB7e",
        config: "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ", bump: 255,
        tickSpacing: 2, feeTierIndexSeed: 1027, feeRate: 200, protocolFeeRate: 1300,
        vaultA: "5fEq5SYpSpnDUDn8dmXUmZeHVaXpL14UirnGajF9QMor",
        vaultB: "iMH9YW3kAgk4kkB74ZHPHESHAQQWPeGWn6Rmty3WJnq",
        oracle: "GLQdMoJ6RJzWSBLiguhKVqt5K7B6EBSk6xiRBxiLRpbz", adaptiveFeeControlFactor: 80000 }),
    Object.freeze({ pool: "4HppGTweoGQ8ZZ6UcCgwJKfi5mJD9Dqwy6htCpnbfBLW",
        config: "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ", bump: 251,
        tickSpacing: 4, feeTierIndexSeed: 1028, feeRate: 400, protocolFeeRate: 1300,
        vaultA: "htf1KLePyGs8R6xUZ1oEYmkStQ21uP1Hq8GY5P5Mp2G",
        vaultB: "9ma53jxdWJ3RmumpJBJGSSmDJB9ENNEey6frh8iTGvM4",
        oracle: "31HfnCJfkAmdiAqXTRPVCPo9uDXLRstpK7tU2kk5zYB7", adaptiveFeeControlFactor: 60000 }),
]);
export function reviewedWhirlpoolV2Pool(pool) {
    const found = REVIEWED_WHIRLPOOL_V2_POOLS.find(row => row.pool === pool);
    if (found === undefined)
        throw new ApnError("APN_OPERATION_BLOCKED", "Jupiter WhirlpoolSwapV2 pool is outside the finite reviewed set.");
    return found;
}
//# sourceMappingURL=v1-whirlpool-v2-pools.js.map