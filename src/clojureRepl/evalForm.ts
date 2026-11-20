/**
 * Evaluates a single top-level Clojure form from a source file
 *
 * Uses Edamame source positions to select a top-level definition by name or a form containing a one-based line. Loads no other forms; the target namespace must already exist in the REPL.
 * @param opts.path Source path below src/ or test/.
 * @param opts.symbol Unqualified name of a top-level definition.
 * @param opts.line One-based line inside the form.
 * @param opts.format Value format.
 * @param opts.sessionId Optional nREPL session.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Source path below src/ or test/. */
        path: string;
        /** Unqualified name of a top-level definition. */
        symbol?: string;
        /** One-based line inside the form. */
        line?: number;
        /** Value format. */
        format?: "json" | "edn";
        /** Optional nREPL session. */
        sessionId?: string;
    },
): Promise<{ path: string; line: number; namespace: string; messages: Record<string, unknown>[] }> {
    if (!!opts.symbol === (opts.line !== undefined)) throw new Error("Specify either symbol or line");
    if (opts.line !== undefined && (!Number.isSafeInteger(opts.line) || opts.line < 1)) throw new Error("Expected a positive line number");
    const ws=await ctx.fns.clojureRepl.localTarget({});
    const fs=await import("node:fs/promises");
    if (!/^(src|test)\/.+\.cljc?$/.test(opts.path)) throw new Error("Expected Clojure source under src/ or test/");
    const path=await fs.realpath(ws.dir+"/"+opts.path);
    if (!["src","test"].some(dir=>path.startsWith(ws.dir+"/"+dir+"/"))) throw new Error("Source escapes workspace");
    const file=Bun.file(path);
    if (file.size>24000) throw new Error("Source exceeds 24 KB");
    const source=await file.text();
    const selected=await ctx.fns.clojureRepl.request({op:"eval",format:"json",code:`(do (require 'edamame.core 'clojure.string)
    (let [source ${JSON.stringify(source)}
          forms (edamame.core/parse-string-all source {:all true :read-cond :allow :features #{:clj}})
          namespace (some #(when (and (seq? %) (= 'ns (first %))) (second %)) forms)
          matches (filter #(let [{:keys [row end-row]} (meta %)]
                             (if ${opts.line === undefined ? "false" : "true"}
                               (and row end-row (<= row ${opts.line ?? 0} end-row))
                               (and (seq? %) (symbol? (first %)) (.startsWith (name (first %)) "def") (symbol? (second %)) (= (str (second %)) ${JSON.stringify(opts.symbol ?? "")})))) forms)
          form (first matches)
          {:keys [row col end-row end-col]} (meta form)
          lines (clojure.string/split source (re-pattern (str (char 10))) -1)
          offset (fn [r c] (+ (reduce + (map #(inc (count %)) (take (dec r) lines))) (dec c)))]
      (when-not (and namespace (= 1 (count matches)) row col end-row end-col) (throw (ex-info "Expected one top-level form with source positions" {})))
      {:namespace (str namespace) :line row :code (subs source (offset row col) (offset end-row end-col))}))`});
    const v=selected.messages.find(m=>m.value)?.value as {namespace:string;line:number;code:string}|undefined;
    if(!v?.code) throw new Error(String(selected.messages.find(m=>m.err)?.err ?? "Form not found"));
    const result=await ctx.fns.clojureRepl.request({op:"eval",ns:v.namespace,code:v.code,format:opts.format,sessionId:opts.sessionId});
    return {path:opts.path,line:v.line,namespace:v.namespace,messages:result.messages};
}
