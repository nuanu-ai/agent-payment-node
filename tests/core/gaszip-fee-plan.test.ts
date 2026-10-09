import assert from "node:assert/strict";
import test from "node:test";
import { assertSeiFundingFresh } from "../../src/lifi/sei-gaszip-rpc.js";
import { assertMegaFundingFresh } from "../../src/lifi/mega-gaszip-rpc.js";
const frozen={blockHash:`0x${"1".repeat(64)}` as const,nonce:"5",gas:"23382",maxFee:"11000000",tip:"1000000",l1FeeUpper:"5196823140",operatorFeeUpper:"0",feeUpper:"262398823140"};
for(const fresh of [assertSeiFundingFresh,assertMegaFundingFresh])test(`${fresh.name} reprices unsigned fees within original caller cap`,()=>{
 const original=JSON.stringify(frozen),cap="1000000000000";
 fresh(frozen,{...frozen,l1FeeUpper:"5078223958",feeUpper:"262280223958"},cap);
 fresh(frozen,{...frozen,l1FeeUpper:"105196823140",feeUpper:"362398823140"},cap);
 fresh(frozen,{...frozen,maxFee:"17000000",gas:"22000",l1FeeUpper:"105196823140"},cap);
 for(const drift of [{nonce:"6"},{gas:"23383"},{tip:"1000001"},{maxFee:"23000000"},{l1FeeUpper:"742798000001"},{operatorFeeUpper:"742798000001"}])assert.throws(()=>fresh(frozen,{...frozen,...drift},cap));
 assert.equal(JSON.stringify(frozen),original);
});
