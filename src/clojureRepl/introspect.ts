/**
 * Lists loaded Clojure namespaces and inspects Vars over stock nREPL
 *
 * Read-only introspection using the Clojure core namespace API. No CIDER middleware is required. Supports loaded namespaces, public Vars and metadata about one Var.
 * @param opts.namespace Loaded namespace name.
 * @param opts.symbol Unqualified Var name inside the namespace.
 * @param opts.prefix Optional literal name prefix for lists.
 * @param opts.limit Maximum rows, default 100, up to 500.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Loaded namespace name. */
        namespace?: string;
        /** Unqualified Var name inside the namespace. */
        symbol?: string;
        /** Optional literal name prefix for lists. */
        prefix?: string;
        /** Maximum rows, default 100, up to 500. */
        limit?: number;
    },
): Promise<{ kind: string; total: number; items: Record<string, unknown>[] }> {
    const { namespace, symbol, prefix = "", limit = 100 } = opts;
    if ([namespace,symbol,prefix].some(s=>s!==undefined&&(typeof s!=="string"||s.length>240||[...s].some(c=>c.charCodeAt(0)<32)))) throw Error("Invalid name or prefix");
    if (symbol!==undefined && (!namespace || !symbol || prefix)) throw Error("Provide a namespace and symbol, without prefix");
    if (!Number.isInteger(limit)||limit<1||limit>500) throw Error("Limit must be 1 to 500");
    const cljString=(str:string|undefined)=>str===undefined?'nil':JSON.stringify(str);
    const code='(let [n '+cljString(namespace)+' s '+cljString(symbol)+' p '+cljString(prefix)+' lim '+limit+"\n      target (when n (find-ns (symbol n)))\n      match? (fn [x] (.startsWith ^String (str x) p))\n      summary (fn [v] (let [{:keys [name ns file line column arglists doc macro private]} (meta v)]\n                        (cond-> {:name (str name) :namespace (str (ns-name ns)) :file file :line line :column column}\n                          arglists (assoc :arglists (binding [*print-length* 12 *print-level* 5] (pr-str arglists)))\n                          macro (assoc :macro true)\n                          private (assoc :private true)\n                          (and s (string? doc)) (assoc :doc (subs doc 0 (min 8000 (count doc)))))))\n      _ (when (and n (not target)) (throw (ex-info \"Namespace is not loaded\" {})))\n      v (when s (get (ns-interns target) (symbol s)))\n      _ (when (and s (not v)) (throw (ex-info \"Var not found\" {})))\n      rows (cond s [v]\n                 n (->> (ns-publics target) (filter (comp match? key)) (sort-by (comp str key)) (map val))\n                 :else (->> (all-ns) (map (comp str ns-name)) (filter match?) sort))]\n  {:kind (cond s \"var\" n \"vars\" :else \"namespaces\") :total (count rows)\n   :items (mapv (if n summary (fn [name] {:name name})) (take lim rows))})";
    const r=await ctx.fns.clojureRepl.request({op:'eval',ns:'clojure.core',format:'json',code});
    const value=r.messages.find(m=>Object.hasOwn(m,'value'))?.value;
    if(!value || r.messages.some(m=>Array.isArray(m.status)&&m.status.includes('eval-error'))) throw Error(String(r.messages.find(m=>m.err)?.err ?? 'Introspection failed'));
    return value as {kind:string;total:number;items:Record<string,unknown>[]};
}
