/**
 * Runs or interrupts evaluation in a named nREPL session
 *
 * Names are scoped to the calling agent. Use an explicit request ID to interrupt only that evaluation. Named sessions are kept in Hyper memory and do not survive JVM or Hyper restart.
 * @param opts.name Name scoped to the current agent.
 * @param opts.action Session action.
 * @param opts.code Clojure code for eval.
 * @param opts.id Request ID for eval, or ID of the evaluation to interrupt.
 * @param opts.format Value format.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Name scoped to the current agent. */
        name: string;
        /** Session action. */
        action: "eval" | "interrupt" | "close";
        /** Clojure code for eval. */
        code?: string;
        /** Request ID for eval, or ID of the evaluation to interrupt. */
        id?: string;
        /** Value format. */
        format?: "edn" | "json";
    },
): Promise<{ id: string; values: unknown[]; stdout: string; stderr: string; status: string[] }> {
    const ws=await ctx.fns.clojureRepl.localTarget({});
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(opts.name)) throw new Error("Invalid session name");
    if (!["eval","interrupt","close"].includes(opts.action)) throw new Error("Unknown session action");
    const {id:owner}=await ctx.fns.agent.current({});
    const state=ctx.state as any;
    const map: Map<string,Promise<string>>=state.clojureNamedSessions ??= new Map();
    const key=owner+":"+opts.name;
    let entry=map.get(key);
    if(!entry && opts.action==="eval") {
        if(map.size>=128) throw new Error("Session limit reached; close a session first");
        entry=ctx.fns.clojureRepl.request({op:"clone"}).then(r=>{
            const id=r.messages.find(m=>typeof m["new-session"]==="string")?.["new-session"];
            if(typeof id!=="string") throw new Error("Could not clone nREPL session");
            return id;
        });
        map.set(key,entry);
    }
    if(!entry) throw new Error("Named session not found");
    let sessionId: string;
    try {sessionId=await entry;} catch(e) {if(map.get(key)===entry)map.delete(key); throw e;}
    const active: Map<string,(messages:Record<string,unknown>[])=>void>=state.clojureActiveEvals ??= new Map();
    const evalId=opts.id ?? crypto.randomUUID();
    if(opts.action==="interrupt"&&!opts.id) throw new Error("Specify the evaluation ID to interrupt");
    const prefix=key+":"+sessionId+":";
    const activeKey=prefix+evalId;
    if(opts.action==="eval"&&active.has(activeKey)) throw new Error("Evaluation ID is already in use");
    const interrupted=opts.action==="eval" ? new Promise<{id:string;messages:Record<string,unknown>[]}>(resolve=>active.set(activeKey,messages=>resolve({id:evalId,messages}))) : undefined;
    let result: {id:string;messages:Record<string,unknown>[]};
    try {
        const request=ctx.fns.clojureRepl.request({op:opts.action,sessionId,code:opts.code,format:opts.action==="eval"?opts.format:undefined,id:opts.action==="eval"?evalId:undefined,interruptId:opts.action==="interrupt"?opts.id:undefined});
        result=await (interrupted?Promise.race([request,interrupted]):request);
        if(opts.action==="interrupt") {
            const event=result.messages.find(m=>m.id===opts.id && Array.isArray(m.status) && m.status.includes("interrupted"));
            if(event)active.get(prefix+opts.id)?.([event]);
        }
    } finally { if(opts.action==="eval")active.delete(activeKey); }
    const status=[...new Set(result.messages.flatMap(m=>Array.isArray(m.status)?m.status.map(String):[]))];
    if ((status.includes("session-closed")||status.includes("unknown-session"))&&map.get(key)===entry)map.delete(key);
    return {id:result.id,values:result.messages.filter(m=>Object.hasOwn(m,"value")).map(m=>m.value),stdout:result.messages.map(m=>m.out??"").join(""),stderr:result.messages.map(m=>m.err??"").join(""),status};
}
