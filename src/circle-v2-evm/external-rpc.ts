import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";
import { BridgeHttps } from "../lifi/https.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { circleBlocked } from "./operation-model.js";
import { circleRecord } from "./protocol.js";
import { CircleRpc } from "./rpc.js";
const METHODS = new Set(["eth_chainId","eth_getBlockByNumber","eth_getBalance","eth_getCode","eth_getStorageAt","eth_call","eth_getTransactionReceipt","eth_getTransactionByHash","eth_getTransactionCount","eth_getLogs"]);
/** One shared physical POST/deadline/concurrency budget for both public chains. No signing methods or retries. */
export class CircleExternalRpcBudget {
  private requests=0; private inFlight=0; private waiters:(()=>void)[]=[];
  readonly evidence: { readonly chain:number; readonly method:string; readonly params:readonly unknown[]; readonly result:unknown }[]=[];
  constructor(private readonly now:()=>number,private readonly endsAt:number,readonly transport:Pick<BridgeHttps,"request">) {}
  assert():void {if(this.now()>=this.endsAt)circleBlocked("external_read_deadline");}
  async post(endpoint:string,chain:number,id:number,method:string,params:readonly unknown[]):Promise<unknown>{
    this.assert();if(!METHODS.has(method)||++this.requests>160)circleBlocked("external_read_budget_or_method");
    if(this.inFlight>=4)await new Promise<void>(resolve=>this.waiters.push(resolve));else this.inFlight++;
    try {this.assert();const response=await this.transport.request(endpoint,"POST",canonicalJson({jsonrpc:"2.0",id,method,params}),1024*1024,"APN_RPC_CONFIG",()=>this.assert());this.assert();
      if(response.status!==200)throw new ApnError("APN_RPC_CONFIG","External Circle proof RPC HTTP failure.");const value=circleRecord(JSON.parse(response.body));
      if(value.jsonrpc!=="2.0"||value.id!==id||!Object.hasOwn(value,"result")||Object.hasOwn(value,"error"))throw new ApnError("APN_RPC_PROTOCOL","External Circle proof RPC envelope failure.");
      this.evidence.push({chain,method,params,result:value.result});return value.result;
    }finally{const next=this.waiters.shift();if(next===undefined)this.inFlight--;else next();}
  }
}
export class CircleExternalRpc extends CircleRpc {
  private id=0;private count=0;private readonly publicEndpoint:string;
  constructor(url:string,chain:number,private readonly budget:CircleExternalRpcBudget){super(url,chain);const p=parsePublicHttpsUrl(url,"APN_RPC_CONFIG","External Circle RPC",2048);if(p.search!==""||p.hash!=="")circleBlocked("external_rpc_url");this.publicEndpoint=p.toString();}
  override async call(method:string,params:readonly unknown[],beforeSend?:()=>void):Promise<unknown>{
    if(beforeSend!==undefined||++this.count>128)circleBlocked("external_rpc_financial_or_origin_budget");
    if(method==="eth_getLogs"){const q=circleRecord(params[0]);if(params.length!==1||typeof q.blockHash!=="string"||q.fromBlock!==undefined||q.toBlock!==undefined)circleBlocked("external_logs_exact_block_required");}
    return this.budget.post(this.publicEndpoint,this.chainId,++this.id,method,params);
  }
}
