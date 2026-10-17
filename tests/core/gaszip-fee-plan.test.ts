import assert from "node:assert/strict";
import test from "node:test";
import { GASZIP_DIRECT_ROUTES, gaszipCodec, inspectGaszipDelivery, inspectGaszipFundingQuote, type GaszipCorrelatedDelivery } from "../../src/lifi/gaszip-direct-route.js";
import { GaszipFundingJournal, publicGaszipFunding, sealGaszipFunding, validateGaszipFunding, type GaszipFundingRecord } from "../../src/lifi/gaszip-direct-journal.js";
import { GaszipFundingRpc, assertGaszipFundingFresh, proveGaszipDelivery, proveGaszipSafeTransaction, readGaszipFundingPlan, type GaszipRpcPort } from "../../src/lifi/gaszip-direct-rpc.js";
import { GaszipFundingService } from "../../src/lifi/gaszip-direct-service.js";
const SEI_ROUTE=GASZIP_DIRECT_ROUTES.sei,MEGA_ROUTE=GASZIP_DIRECT_ROUTES.mega,seiCodec=gaszipCodec(SEI_ROUTE),megaCodec=gaszipCodec(MEGA_ROUTE);
const frozen={blockHash:`0x${"1".repeat(64)}` as const,nonce:"5",gas:"23382",maxFee:"11000000",tip:"1000000",l1FeeUpper:"5196823140",operatorFeeUpper:"0",feeUpper:"262398823140"};
for(const route of [SEI_ROUTE,MEGA_ROUTE])test(`${route.lane} GasZip plan freshness reprices unsigned fees within original caller cap`,()=>{
 const original=JSON.stringify(frozen),cap="1000000000000",fresh=(a:typeof frozen,b:typeof frozen,c:string)=>assertGaszipFundingFresh(route,a,b,c);
 fresh(frozen,{...frozen,l1FeeUpper:"5078223958",feeUpper:"262280223958"},cap);
 fresh(frozen,{...frozen,l1FeeUpper:"105196823140",feeUpper:"362398823140"},cap);
 fresh(frozen,{...frozen,maxFee:"17000000",gas:"22000",l1FeeUpper:"105196823140"},cap);
 for(const drift of [{nonce:"6"},{gas:"23383"},{tip:"1000001"},{maxFee:"23000000"},{l1FeeUpper:"742798000001"},{operatorFeeUpper:"742798000001"}])assert.throws(()=>fresh(frozen,{...frozen,...drift},cap));
 assert.equal(JSON.stringify(frozen),original);
});
