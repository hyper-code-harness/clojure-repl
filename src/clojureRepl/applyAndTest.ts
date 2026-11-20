/**
 * Previews or applies a Clojure edit and runs tests in the live JVM
 *
 * Preview a single exact replacement, then apply it with the returned SHA-256 revision. Reloads source and specified test files with nREPL and returns structured clojure.test failures and file/line locations. Optional rollback restores the old source and reloads it after a failed check; cannot undo side effects.
 * @param opts.path Clojure source below src/.
 * @param opts.oldText Exact text occurring once.
 * @param opts.newText Replacement text.
 * @param opts.tests Test source files below test/.
 * @param opts.revision Revision returned by preview; omit for preview only.
 * @param opts.rollbackOnFailure Restore old source and reload it after a failure.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Clojure source below src/. */
        path: string;
        /** Exact text occurring once. */
        oldText: string;
        /** Replacement text. */
        newText: string;
        /** Test source files below test/. */
        tests: string[];
        /** Revision returned by preview; omit for preview only. */
        revision?: string;
        /** Restore old source and reload it after a failure. */
        rollbackOnFailure?: boolean;
    },
): Promise<Record<string, unknown>> {
    const ws=await ctx.fns.clojureRepl.localTarget({});
    if (!/^src\/.+\.clj$/.test(opts.path) || typeof opts.oldText!=="string" || !opts.oldText || typeof opts.newText!=="string") throw new Error("Expected source path and nonempty exact replacement");
    if(!Array.isArray(opts.tests)||opts.tests.length<1||opts.tests.length>5||opts.tests.some(p=>typeof p!=="string"||!/^test\/.+\.clj$/.test(p))) throw new Error("Provide 1–5 test files under test/");
    const fs=await import("node:fs/promises");
    const path=await fs.realpath(ws.dir+"/"+opts.path);
    if(!path.startsWith(ws.dir+"/src/")) throw new Error("Source escapes workspace");
    const state=ctx.state as any;
    const locks: Set<string>=state.clojureApplyLocks ??= new Set();
    if(locks.size) throw new Error("Another live edit is in progress");
    locks.add(path);
    try {
        if((await fs.stat(path)).size>64000) throw new Error("Source exceeds 64 KB");
        const before=await fs.readFile(path,"utf8");
        const at=before.indexOf(opts.oldText);
        if(at<0||at!==before.lastIndexOf(opts.oldText)) throw new Error("oldText must match exactly once");
        const after=before.slice(0,at)+opts.newText+before.slice(at+opts.oldText.length);
        if(Buffer.byteLength(after)>64000) throw new Error("Updated source exceeds 64 KB");
        const revision=new Bun.CryptoHasher("sha256").update(JSON.stringify([opts.path,before,opts.oldText,opts.newText,opts.tests,!!opts.rollbackOnFailure])).digest("hex");
        if(opts.revision===undefined) return {phase:"preview",revision,path:opts.path,line:before.slice(0,at).split("\n").length,before:opts.oldText,after:opts.newText,tests:opts.tests};
        if(opts.revision!==revision) throw new Error("Source or edit changed; preview it again");
        const req=ctx.fns.clojureRepl.request;
        const ns: string[]=[];
        for(const p of opts.tests){
            const resolved=await fs.realpath(ws.dir+"/"+p);
            if(!resolved.startsWith(ws.dir+"/test/")||(await fs.stat(resolved)).size>64000)throw new Error("Invalid test source path");
            const match=(await fs.readFile(resolved,"utf8")).match(/\(ns\s+([\w.-]+)/);
            if(!match?.[1])throw new Error("Cannot determine test namespace: "+p);
            if(!ns.includes(match[1]))ns.push(match[1]);
        }
        const failed=(m:Record<string,unknown>)=>m.ex||Array.isArray(m.status)&&m.status.some(s=>/error/.test(String(s)));
        const write=async(content:string)=>{
           const tmp=path+"."+crypto.randomUUID()+".tmp";
           try {await fs.writeFile(tmp,content,{flag:"wx",mode:(await fs.stat(path)).mode&0o777});await fs.rename(tmp,path);}
           finally {await fs.unlink(tmp).catch(()=>{});}
        };
        await write(after);
        let phase="reload", details:unknown, ok=false;
        try {
            for(const p of [opts.path,...opts.tests]) {
                const loaded=await req({op:"load-file",path:p});
                if(loaded.messages.some(failed))throw new Error(p+": "+loaded.messages.map(m=>m.err??"").join("").slice(0,2200));
            }
            phase="test";
            const result=await req({op:"eval",format:"json",code:`(do (require 'clojure.test)
    (let [report (var-get #'clojure.test/report)
          failures (atom [])
          active (volatile! true)
          target (Thread/currentThread)
          result (try (with-redefs [clojure.test/report (fn [event]
                                              (when (and @active (identical? target (Thread/currentThread)) (#{:fail :error} (:type event)) (< (count @failures) 20))
                                                (swap! failures conj (assoc (select-keys event [:type :file :line :message]) :test (some-> clojure.test/*testing-vars* first meta :name str))))
                                              (report event))]
                        (clojure.test/run-tests ${ns.map(n=>"'"+n).join(" ")}))
                      (finally (vreset! active false)))]
      (assoc result :failures @failures)))`});
            details=result.messages.find(m=>m.value)?.value;
            if(!details || result.messages.some(failed)) throw new Error(result.messages.map(m=>m.err??"").join("").slice(0,2200)||"Tests returned no summary");
            const summary=details as {test:number;fail:number;error:number};
            ok=summary.test>0 && summary.fail===0 && summary.error===0;
        } catch(e) { details={error:String(e)}; }
        let rollback:unknown;
        if(!ok&&opts.rollbackOnFailure) {
            try {
                if(await fs.readFile(path,"utf8")!==after) throw new Error("File changed after apply; not overwritten");
                await write(before);
                const loaded=await req({op:"load-file",path:opts.path});
                rollback={restored:true,reloaded:!loaded.messages.some(failed)};
            } catch(e) { rollback={error:String(e)}; }
        }
        return {phase,path:opts.path,ok,details,rollback};
    } finally {locks.delete(path);}
}
