import type { JupiterV1SemanticAccount } from "./v1-material.js";
/** Finite reviewed identity. No field is admitted from a quote or policy override. */
export declare const REVIEWED_WHIRLPOOL_FP: Readonly<{
    pool: "FpCMFDFGYotvufJ7HrFHsWEiiQCGbkLCtwHiDnh7o28Q";
    config: "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ";
    bump: 254;
    tickSpacing: 2;
    feeTierIndexSeed: 2;
    feeRate: 200;
    protocolFeeRate: 1300;
    vaultA: "6mQ8xEaHdTikyMvvMxUctYch6dUjnKgfoeib2msyMMi1";
    vaultB: "AQ36QRk3HAe6PHqBCtKTQnYKpt2kAagq9YoeTqUPMGHx";
    oracle: "923j69hYbT5Set5kYfiQr1D8jPL6z15tbfTbVLSwUWJD";
}>;
export declare function decodeReviewedWhirlpoolFpPool(a: JupiterV1SemanticAccount): import("../orca-solana/accounts.js").WhirlpoolState;
export declare function validateReviewedWhirlpoolFpPool(a: JupiterV1SemanticAccount): Promise<void>;
