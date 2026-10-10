import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
for(const scenario of ["positive","unknown","expired","custody","project","pending","policy","wrongcustody","fees","balance","reverted","op","native-crosschain","alias-samechain","alias-otherchain","sameprofile","newpolicy","newpolicy-op","mismatch-old","mismatch-new","newpolicy-pre-drift","newpolicy-drift"]) test(`TEST ${scenario} pseudoTTY follows normal private owner issuer, one claim, replay refusal and authentic full fee settlement`,{timeout:60000},async()=>{
  const fixture=fileURLToPath(new URL("../fixtures/metamask-native-owner/driver.mjs",import.meta.url));
  const source=fileURLToPath(new URL("../../src/",import.meta.url));
  const ptyProgram=`import os, pty, select, signal, sys
pid, master = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])
def stop(signum, frame):
    os.kill(pid, signal.SIGHUP)
signal.signal(signal.SIGTERM, stop)
while True:
    ready, _, _ = select.select([master, 0], [], [])
    if master in ready:
        try: data = os.read(master, 65536)
        except OSError: break
        if not data: break
        os.write(1, data)
    if 0 in ready:
        data = os.read(0, 65536)
        if data: os.write(master, data)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
`;
  const child=spawn("python3",["-c",ptyProgram,process.execPath,"--experimental-test-module-mocks",fixture,source,scenario],{stdio:["pipe","pipe","pipe"]});
  let output="",sent=false,sentPhrases=new Set<string>();const done=new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});
  const collect=(data:Buffer)=>{output+=data.toString();for(const match of output.matchAll(/Type ([^\r\n]+) and press Enter to confirm\./g)){const phrase=match[1]!;if(!sentPhrases.has(phrase)){sentPhrases.add(phrase);sent=true;child.stdin.write(`${phrase}\n`);}}};
  child.stdout.on("data",collect);child.stderr.on("data",collect);
  const deadline=setTimeout(()=>child.kill("SIGTERM"),55000);
  try {const code=await done;assert.equal(code,0,output);assert.match(output,new RegExp(`TEST_OWNER_${scenario.toUpperCase()}_OK`));assert.equal(sent,!["policy","wrongcustody","fees","balance","op","alias-samechain","sameprofile","mismatch-old","mismatch-new"].includes(scenario));} finally {clearTimeout(deadline);child.stdin.destroy();}
});
