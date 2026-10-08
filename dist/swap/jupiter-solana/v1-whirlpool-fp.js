import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { decodeWhirlpool, whirlpoolOracleAddress } from "../orca-solana/accounts.js";
import { WRAPPED_SOL_MINT, SOLANA_USDC_MINT } from "./catalog.js";
import { JUPITER_V1_WHIRLPOOL_FP_POOL, JUPITER_V1_WHIRLPOOL_PROGRAM } from "./v1-pins.js";
/** Finite reviewed identity. No field is admitted from a quote or policy override. */
export const REVIEWED_WHIRLPOOL_FP = Object.freeze({
    pool: JUPITER_V1_WHIRLPOOL_FP_POOL, config: "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
    bump: 254, tickSpacing: 2, feeTierIndexSeed: 2, feeRate: 200, protocolFeeRate: 1300,
    vaultA: "6mQ8xEaHdTikyMvvMxUctYch6dUjnKgfoeib2msyMMi1",
    vaultB: "AQ36QRk3HAe6PHqBCtKTQnYKpt2kAagq9YoeTqUPMGHx",
    oracle: "923j69hYbT5Set5kYfiQr1D8jPL6z15tbfTbVLSwUWJD",
});
function blocked() { throw new ApnError("APN_OPERATION_BLOCKED", "The reviewed static-fee Whirlpool Fp pool changed."); }
export function decodeReviewedWhirlpoolFpPool(a) {
    const d = Buffer.from(a.dataBase64, "base64"), pin = REVIEWED_WHIRLPOOL_FP;
    if (a.address !== pin.pool || a.existence !== "present" || a.owner !== JUPITER_V1_WHIRLPOOL_PROGRAM || a.executable ||
        d.length !== 653 || d.toString("base64") !== a.dataBase64 || sha256(d) !== a.dataHash)
        blocked();
    const state = decodeWhirlpool(a.address, { owner: a.owner, lamports: BigInt(a.lamports), executable: false, space: d.length, data: d }, JUPITER_V1_WHIRLPOOL_PROGRAM, "3f95d10ce1806309");
    if (d[40] !== pin.bump || state.config !== pin.config || state.tickSpacing !== pin.tickSpacing || state.feeTierIndexSeed !== pin.feeTierIndexSeed ||
        state.feeRate !== pin.feeRate || state.protocolFeeRate !== pin.protocolFeeRate || state.mintA !== WRAPPED_SOL_MINT || state.mintB !== SOLANA_USDC_MINT ||
        state.vaultA !== pin.vaultA || state.vaultB !== pin.vaultB || state.tickCurrentIndex < -443636 || state.tickCurrentIndex > 443636 ||
        state.sqrtPrice < 4295048016n || state.sqrtPrice > 79226673515401279992447579055n || state.liquidity === 0n)
        blocked();
    return state;
}
export async function validateReviewedWhirlpoolFpPool(a) {
    const state = decodeReviewedWhirlpoolFpPool(a), enc = getAddressEncoder(), seed = Buffer.alloc(2);
    seed.writeUInt16LE(state.feeTierIndexSeed);
    const [pda, bump] = await getProgramDerivedAddress({ programAddress: address(JUPITER_V1_WHIRLPOOL_PROGRAM),
        seeds: [Buffer.from("whirlpool"), enc.encode(address(state.config)), enc.encode(address(state.mintA)), enc.encode(address(state.mintB)), seed] });
    if (pda !== REVIEWED_WHIRLPOOL_FP.pool || bump !== REVIEWED_WHIRLPOOL_FP.bump ||
        await whirlpoolOracleAddress(JUPITER_V1_WHIRLPOOL_PROGRAM, state.address) !== REVIEWED_WHIRLPOOL_FP.oracle)
        blocked();
}
//# sourceMappingURL=v1-whirlpool-fp.js.map