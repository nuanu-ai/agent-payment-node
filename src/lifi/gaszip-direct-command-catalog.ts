import type { CommandDefinition, CommandOption } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
import { bridgeAddress, bridgeHash, bridgeUint } from "./validation.js";
import { GASZIP_DIRECT_ROUTES, type GaszipDirectRoute } from "./gaszip-direct-route.js";
import { GASZIP_STATES, GASZIP_TERMINAL_STATES } from "./gaszip-outcome.js";
const option=(name:CommandOption["name"],type:CommandOption["type"],...extra:readonly string[]):CommandOption=>({name,type,required:true,default:{kind:"none"},constraints:["explicit_finite_input",...extra],sensitivity:"operator_input"});
/** The published states are the journal's own lists, so every outcome a record may hold (destination_failed too) is named. */
const states={terminal:[...GASZIP_TERMINAL_STATES],non_terminal:GASZIP_STATES.filter(state=>!GASZIP_TERMINAL_STATES.includes(state))};
/** Example destination floors only; the caller always supplies its own amount, floor and fee ceiling. */
const EXAMPLE_FLOOR:Readonly<Record<GaszipDirectRoute["lane"],string>>={mega:"8000000000000",sei:"250000000000000000"};
function commands(route:GaszipDirectRoute):readonly CommandDefinition[]{
  const g=route.lane,name=route.destinationName,output={contract:"apn.cli.v1",success_exit:0,failure_exit:1,success:`Durable finite ${name} funding state.`,failures:["Classified refusal; no automatic resend."]} as const;
  return [
    {path:[g,"funding","prepare"],synopsis:`apn ${g} funding prepare --profile <profile> --expected-payer <address> --amount-atomic <wei> --minimum-output-atomic <${g}-wei> --maximum-fee-atomic <wei> --idempotency-key <key>`,summary:`Freeze the finite GasZip direct Base ETH to ${name} ${route.destinationAsset} self funding lane.`,options:[option("--profile","profile"),option("--expected-payer","address"),option("--amount-atomic","wei"),option("--minimum-output-atomic","wei"),option("--maximum-fee-atomic","wei"),option("--idempotency-key","idempotency_key","8_to_200_safe_ascii_characters")],effect:{class:"payment_prepare",summary:"Reads quote, Base identity and total fees; saves unsigned exact deposit."},approval:{class:"none",when:"Unsigned preparation."},output,states,recovery:[{command_path:[g,"funding","approve"],when:"After reviewing the frozen self deposit."}],examples:[`apn ${g} funding prepare --profile default --expected-payer <address> --amount-atomic 10000000000000 --minimum-output-atomic ${EXAMPLE_FLOOR[g]} --maximum-fee-atomic 1000000000000 --idempotency-key ${g}-self-funding-01`]},
    {path:[g,"funding","approve"],synopsis:`apn ${g} funding approve --operation <operation-id>`,summary:"Foreground confirm, sign and attempt the exact finite deposit once.",options:[option("--operation","operation_id")],effect:{class:"payment_submit",summary:"May send one Base native deposit; holds ambiguous outcomes."},approval:{class:"foreground_tty",when:"Before the durable signing marker."},output,states,recovery:[{command_path:[g,"funding","status"],when:`Observe source and correlated ${name} delivery without resend.`}],examples:[`apn ${g} funding approve --operation <operation-id>`]},
    {path:[g,"funding","status"],synopsis:`apn ${g} funding status --operation <operation-id>`,summary:"Observe exact safe source and correlated destination effects without signing or resend.",options:[option("--operation","operation_id")],effect:{class:"network_read",summary:"Reads both chain RPCs and fixed provider deposit mapping; may finalize durable usage."},approval:{class:"prior_operation_authorization",when:"Only the saved operation is observed."},output,states,recovery:[],examples:[`apn ${g} funding status --operation <operation-id>`]},
  ];
}
export const SEI_FUNDING_COMMANDS=commands(GASZIP_DIRECT_ROUTES.sei);
export const MEGA_FUNDING_COMMANDS=commands(GASZIP_DIRECT_ROUTES.mega);
/** Binds `apn <lane> funding prepare|approve|status` for the route named by the command group. */
export function bindGaszipFundingCommand(path:string,o:Record<string,string>):CommandRequest{
  const operationId=()=>bridgeHash(o["--operation"],"APN_INVALID_INPUT");
  const prepare=()=>({profile:o["--profile"]!,expectedPayer:bridgeAddress(o["--expected-payer"],"APN_INVALID_INPUT"),amountAtomic:bridgeUint(o["--amount-atomic"],true,"APN_INVALID_INPUT").toString(),minimumOutputAtomic:bridgeUint(o["--minimum-output-atomic"],true,"APN_INVALID_INPUT").toString(),maximumFeeAtomic:bridgeUint(o["--maximum-fee-atomic"],true,"APN_INVALID_INPUT").toString(),idempotencyKey:o["--idempotency-key"]!});
  switch(path){
    case "mega funding prepare": return {command:"mega.funding.prepare",...prepare()};
    case "mega funding approve": return {command:"mega.funding.approve",operationId:operationId()};
    case "mega funding status": return {command:"mega.funding.status",operationId:operationId()};
    case "sei funding prepare": return {command:"sei.funding.prepare",...prepare()};
    case "sei funding approve": return {command:"sei.funding.approve",operationId:operationId()};
    case "sei funding status": return {command:"sei.funding.status",operationId:operationId()};
  }
  throw new Error("Unknown finite GasZip command");
}
