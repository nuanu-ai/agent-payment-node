import { address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { associatedTokenAddress, whirlpoolTickArrayAddress, whirlpoolOracleAddress } from "../orca-solana/accounts.js";
import type { JupiterV1SemanticAccount } from "./v1-material.js";
import type { JupiterV1RawBuildResponse } from "./v1-codec.js";
import { whirlpoolV2NamedRoles, type WhirlpoolV2NamedRoles } from "./v1-route-config.js";
import { JUPITER_V1_WHIRLPOOL_PROGRAM as ORCA, JUPITER_V1_MEMO_PIN, JUPITER_V1_WHIRLPOOL_V2_FIXED_PROGRAM_PINS } from "./v1-pins.js";
import { reviewedWhirlpoolV2Pool } from "./v1-whirlpool-v2-pools.js";
import { TOKEN_PROGRAM, WRAPPED_SOL_MINT as SOL, SOLANA_USDC_MINT as USDC } from "./catalog.js";
export interface MutableByteRange { readonly offset: number; readonly length: number }
export interface WhirlpoolV2PoolState { readonly config: string; readonly bump: number; readonly feeTierIndexSeed: number; readonly tickSpacing: 2 | 4; readonly feeRate: 200 | 400; readonly protocolFeeRate: 1300; readonly mintA: string; readonly mintB: string; readonly vaultA: string; readonly vaultB: string; readonly liquidity: bigint; readonly sqrtPrice: bigint; readonly tickCurrentIndex: number; readonly mutableRanges: readonly MutableByteRange[] }
export interface WhirlpoolV2Tick { readonly initialized: boolean; readonly liquidityNet: bigint; readonly liquidityGross: bigint; readonly feeGrowthOutsideA: bigint; readonly feeGrowthOutsideB: bigint; readonly rewardGrowthsOutside: readonly bigint[] }
export interface WhirlpoolV2TickArrayState { readonly kind: "fixed" | "dynamic"; readonly address: string; readonly whirlpool: string; readonly startTickIndex: number; readonly bitmap: bigint; readonly ticks: readonly WhirlpoolV2Tick[]; readonly mutableRanges: readonly MutableByteRange[] }
export interface WhirlpoolV2OracleState { readonly whirlpool: string; readonly tradeEnableTimestamp: bigint; readonly constants: { readonly filterPeriod: number; readonly decayPeriod: number; readonly reductionFactor: number; readonly adaptiveFeeControlFactor: number; readonly maxVolatilityAccumulator: number; readonly tickGroupSize: number; readonly majorSwapThresholdTicks: number }; readonly variables: { readonly lastReferenceUpdateTimestamp: bigint; readonly lastMajorSwapTimestamp: bigint; readonly volatilityReference: number; readonly tickGroupIndexReference: number; readonly volatilityAccumulator: number }; readonly mutableRanges: readonly MutableByteRange[] }
function blocked(reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", `Jupiter WhirlpoolSwapV2 ${reason} is missing or malformed.`); }
function bytes(a: JupiterV1SemanticAccount, owner: string): Buffer {
    const d = Buffer.from(a.dataBase64,"base64");
    if (a.existence !== "present" || a.owner !== owner || a.executable || d.toString("base64") !== a.dataBase64 || sha256(d) !== a.dataHash) blocked("account owner or bytes");
    return d;
}
const key = (d: Buffer, o: number) => getAddressDecoder().decode(d.subarray(o,o+32));
const u128 = (d: Buffer,o: number) => d.readBigUInt64LE(o)+(d.readBigUInt64LE(o+8)<<64n);
const i128 = (d: Buffer,o: number) => { const n=u128(d,o); return n >= (1n<<127n) ? n-(1n<<128n) : n; };
function ranges(rows: readonly MutableByteRange[]): readonly MutableByteRange[] { return Object.freeze(rows.map(r=>Object.freeze({...r}))); }
export function decodeWhirlpoolV2Pool(a: JupiterV1SemanticAccount): WhirlpoolV2PoolState {
    const d=bytes(a,ORCA), reviewed=reviewedWhirlpoolV2Pool(a.address);
    if (d.length!==653 || d.subarray(0,8).toString("hex")!=="3f95d10ce1806309" || key(d,8)!==reviewed.config || d[40]!==reviewed.bump || d.readUInt16LE(41)!==reviewed.tickSpacing || d.readUInt16LE(43)!==reviewed.feeTierIndexSeed || d.readUInt16LE(45)!==reviewed.feeRate || d.readUInt16LE(47)!==reviewed.protocolFeeRate || key(d,101)!==SOL || key(d,181)!==USDC || key(d,133)!==reviewed.vaultA || key(d,213)!==reviewed.vaultB) blocked("pinned pool configuration");
    const tick=d.readInt32LE(81),sqrt=u128(d,65);
    if (tick < -443636 || tick > 443636 || sqrt < 4295048016n || sqrt > 79226673515401279992447579055n) blocked("pool price range");
    const mutable: MutableByteRange[]=[{offset:49,length:44},{offset:165,length:16},{offset:261,length:8}];
    for(let i=0;i<3;i++) if(!d.subarray(269+i*128,301+i*128).equals(Buffer.alloc(32))) mutable.push({offset:381+i*128,length:16});
    return Object.freeze({config:key(d,8),bump:d[40]!,feeTierIndexSeed:reviewed.feeTierIndexSeed,tickSpacing:reviewed.tickSpacing,feeRate:reviewed.feeRate,protocolFeeRate:reviewed.protocolFeeRate,mintA:SOL,mintB:USDC,vaultA:key(d,133),vaultB:key(d,213),liquidity:u128(d,49),sqrtPrice:sqrt,tickCurrentIndex:tick,mutableRanges:ranges(mutable)});
}
export async function assertWhirlpoolV2PoolPda(a: JupiterV1SemanticAccount): Promise<void> {
    const s=decodeWhirlpoolV2Pool(a), d=bytes(a,ORCA);
    const [pda,bump]=await getProgramDerivedAddress({programAddress:address(ORCA),seeds:[Buffer.from("whirlpool"),getAddressEncoder().encode(address(s.config)),getAddressEncoder().encode(address(s.mintA)),getAddressEncoder().encode(address(s.mintB)),d.subarray(43,45)]});
    if(pda!==a.address||bump!==s.bump)blocked("pool PDA");
}
export function decodeWhirlpoolV2TickArray(a: JupiterV1SemanticAccount): WhirlpoolV2TickArrayState {
    const d=bytes(a,ORCA), disc=d.subarray(0,8).toString("hex"), dynamic=disc==="11d8f68ee1c7da38";
    if ((!dynamic&&disc!=="4561bdbe6e0742bb") || (dynamic?(d.length<148||d.length>10004):d.length!==9988)) blocked("tick layout");
    const start=d.readInt32LE(8), pool=key(d,dynamic?12:9956), reviewed=reviewedWhirlpoolV2Pool(pool), width=reviewed.tickSpacing*88;
    if(start%width!==0||start < Math.floor(-443636/width)*width||start>443636)blocked("tick pool or start");
    let bitmap=dynamic?u128(d,44):0n,cursor=dynamic?60:12;
    if(bitmap>>88n)blocked("tick bitmap high bits");
    const ticks: WhirlpoolV2Tick[]=[], mutable: MutableByteRange[]=[];
    for(let i=0;i<88;i++) {
        const flag=d[cursor];
        if(flag!==0&&flag!==1)blocked("tick enum tag");
        if(dynamic&&Boolean((bitmap>>BigInt(i))&1n)!==(flag===1))blocked("tick bitmap/tag disagreement");
        const size=dynamic&&flag===0?1:113;
        if(cursor+size>d.length)blocked("truncated tick");
        let net=0n,gross=0n,fa=0n,fb=0n,rg: bigint[]=[0n,0n,0n];
        if(size===113) { net=i128(d,cursor+1);gross=u128(d,cursor+17);fa=u128(d,cursor+33);fb=u128(d,cursor+49);rg=[u128(d,cursor+65),u128(d,cursor+81),u128(d,cursor+97)]; }
        if(flag===1) { if(gross===0n||(net<0n?-net:net)>gross)blocked("tick liquidity"); mutable.push({offset:cursor+33,length:80}); if(!dynamic)bitmap|=1n<<BigInt(i); }
        else if(net!==0n||gross!==0n)blocked("uninitialized tick liquidity");
        ticks.push(Object.freeze({initialized:flag===1,liquidityNet:net,liquidityGross:gross,feeGrowthOutsideA:fa,feeGrowthOutsideB:fb,rewardGrowthsOutside:Object.freeze(rg)}));
        cursor+=size;
    }
    if(cursor!==(dynamic?d.length:9956))blocked("tick trailing bytes");
    return Object.freeze({kind:dynamic?"dynamic":"fixed",address:a.address,whirlpool:pool,startTickIndex:start,bitmap,ticks:Object.freeze(ticks),mutableRanges:ranges(mutable)});
}
export const WHIRLPOOL_V2_ORACLE_MUTABLE_RANGES = ranges([{offset:82,length:28}]);
export function decodeWhirlpoolV2Oracle(a: JupiterV1SemanticAccount): WhirlpoolV2OracleState {
    const d=bytes(a,ORCA);
    if(d.length!==254)blocked("oracle size");
    const reviewed=reviewedWhirlpoolV2Pool(key(d,8));
    if(a.address!==reviewed.oracle||d.subarray(0,8).toString("hex")!=="8bc283b38cb3e5f4"||d.readBigUInt64LE(40)!==0n||d.subarray(66,82).some(x=>x!==0)||d.subarray(110).some(x=>x!==0))blocked("oracle layout or reserved fields");
    const c={filterPeriod:d.readUInt16LE(48),decayPeriod:d.readUInt16LE(50),reductionFactor:d.readUInt16LE(52),adaptiveFeeControlFactor:d.readUInt32LE(54),maxVolatilityAccumulator:d.readUInt32LE(58),tickGroupSize:d.readUInt16LE(62),majorSwapThresholdTicks:d.readUInt16LE(64)};
    if(c.filterPeriod!==30||c.decayPeriod!==600||c.reductionFactor!==5000||c.adaptiveFeeControlFactor!==reviewed.adaptiveFeeControlFactor||c.maxVolatilityAccumulator!==880000||c.tickGroupSize!==reviewed.tickSpacing||c.majorSwapThresholdTicks!==reviewed.tickSpacing)blocked("oracle reviewed constants");
    const v={lastReferenceUpdateTimestamp:d.readBigUInt64LE(82),lastMajorSwapTimestamp:d.readBigUInt64LE(90),volatilityReference:d.readUInt32LE(98),tickGroupIndexReference:d.readInt32LE(102),volatilityAccumulator:d.readUInt32LE(106)};
    if(v.volatilityReference>c.maxVolatilityAccumulator||v.volatilityAccumulator>c.maxVolatilityAccumulator||v.tickGroupIndexReference<Math.floor(-443636/c.tickGroupSize)||v.tickGroupIndexReference>Math.floor(443636/c.tickGroupSize))blocked("oracle variable range");
    return Object.freeze({whirlpool:reviewed.pool,tradeEnableTimestamp:0n,constants:Object.freeze(c),variables:Object.freeze(v),mutableRanges:WHIRLPOOL_V2_ORACLE_MUTABLE_RANGES});
}
export function assertWhirlpoolV2ClassicMint(a: JupiterV1SemanticAccount, mint: string): void {
    const d=bytes(a,TOKEN_PROGRAM),decimals=mint===SOL?9:mint===USDC?6:blocked("mint identity");
    if(a.address!==mint||d.length!==82||d[44]!==decimals||d[45]!==1||![0,1].includes(d.readUInt32LE(0))||![0,1].includes(d.readUInt32LE(46)))blocked("classic mint");
}
export function assertWhirlpoolV2Memo(a: JupiterV1SemanticAccount): void {
    const p=JUPITER_V1_MEMO_PIN,d=Buffer.from(a.dataBase64,"base64");
    if(a.address!==p.programId||a.existence!=="present"||a.owner!==p.loader||!a.executable||d.length!==p.byteLength||d.toString("base64")!==a.dataBase64||sha256(d)!==p.payloadHash||a.dataHash!==p.payloadHash)blocked("immutable Memo executable pin");
}
export function assertWhirlpoolV2FixedPrograms(accounts: readonly JupiterV1SemanticAccount[]): void {
    for (const pin of JUPITER_V1_WHIRLPOOL_V2_FIXED_PROGRAM_PINS) {
        const a=accounts.find(a=>a.address===pin.programId),d=Buffer.from(a?.dataBase64??"","base64");
        if(a===undefined||a.existence!=="present"||!a.executable||a.owner!==pin.loader||d.toString("base64")!==a.dataBase64||sha256(d)!==pin.payloadHash||a.dataHash!==pin.payloadHash)blocked("fixed executable pin");
    }
}
export function assertWhirlpoolV2ClassicTokenAccount(a: JupiterV1SemanticAccount, mint: string, owner: string): void {
    const d=bytes(a,TOKEN_PROGRAM);
    if(d.length!==165||key(d,0)!==mint||key(d,32)!==owner||d[108]!==1||d.readUInt32LE(72)!==0||d.readUInt32LE(129)!==0||d.readBigUInt64LE(121)!==0n||d.readUInt32LE(109)!==(mint===SOL?1:0))blocked("classic token account");
}
export interface WhirlpoolV2AccountSnapshot { readonly roles: WhirlpoolV2NamedRoles; readonly pool: WhirlpoolV2PoolState; readonly ticks: readonly WhirlpoolV2TickArrayState[]; readonly oracle: WhirlpoolV2OracleState }
/** Synchronous state parsing also runs on material reload; async PDA/ATA checks run in resolver and B guard. */
export function decodeWhirlpoolV2AccountSnapshot(build: JupiterV1RawBuildResponse, accounts: readonly JupiterV1SemanticAccount[]): WhirlpoolV2AccountSnapshot {
    const r=whirlpoolV2NamedRoles(build),row=(k:string)=>accounts.find(a=>a.address===k)??blocked("semantic account");
    const pool=decodeWhirlpoolV2Pool(row(r.pool)), ticks=r.ticks.map(k=>decodeWhirlpoolV2TickArray(row(k))), oracle=decodeWhirlpoolV2Oracle(row(r.oracle));
    assertWhirlpoolV2FixedPrograms(accounts);
    assertWhirlpoolV2ClassicTokenAccount(row(r.vaultA),SOL,r.pool);assertWhirlpoolV2ClassicTokenAccount(row(r.vaultB),USDC,r.pool);assertWhirlpoolV2ClassicTokenAccount(row(r.destination),USDC,r.payer);
    if(row(r.source).existence === "present") assertWhirlpoolV2ClassicTokenAccount(row(r.source),SOL,r.payer);
    assertWhirlpoolV2ClassicMint(row(SOL),SOL);assertWhirlpoolV2ClassicMint(row(USDC),USDC);assertWhirlpoolV2Memo(row(JUPITER_V1_MEMO_PIN.programId));
    const width=pool.tickSpacing*88;
    for(const [i,t] of ticks.entries())if(t.whirlpool!==r.pool||t.startTickIndex!==Math.floor(pool.tickCurrentIndex/width)*width-i*width)blocked("tick pool/direction/order");
    return Object.freeze({roles:r,pool,ticks:Object.freeze(ticks),oracle});
}
export async function validateWhirlpoolV2AccountSnapshot(payer: string, build: JupiterV1RawBuildResponse, accounts: readonly JupiterV1SemanticAccount[]): Promise<WhirlpoolV2AccountSnapshot> {
    const s=decodeWhirlpoolV2AccountSnapshot(build,accounts), r=s.roles;
    if(r.payer!==payer||r.source!==await associatedTokenAddress(payer,SOL,TOKEN_PROGRAM)||r.destination!==await associatedTokenAddress(payer,USDC,TOKEN_PROGRAM))blocked("owned ATA roles");
    await assertWhirlpoolV2PoolPda(accounts.find(a=>a.address===r.pool)!);
    for(const t of s.ticks)if(t.address!==await whirlpoolTickArrayAddress(ORCA,r.pool,t.startTickIndex))blocked("tick PDA");
    if(r.oracle!==await whirlpoolOracleAddress(ORCA,r.pool))blocked("oracle PDA");
    return s;
}
