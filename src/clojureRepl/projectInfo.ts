/**
 * Finds Clojure namespaces, Vars and static references in an indexed project
 *
 * Queries a snapshot created by indexProject. Incoming and outgoing symbol references are separate from namespace requires. External symbols may have references without a local definition. Dynamic dispatch is not inferred.
 * @param opts.root Canonical root returned by indexProject. Defaults to the current workspace.
 * @param opts.symbol Exact namespace or qualified Var. Omit to browse project symbols.
 * @param opts.q Substring filter for browsing; if a namespace is selected, filters its Vars.
 * @param opts.limit Maximum items in each list, 1 to 200, default 40.
 * @param opts.offset Zero-based page offset applied to each list.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Canonical root returned by indexProject. Defaults to the current workspace. */
        root?: string;
        /** Exact namespace or qualified Var. Omit to browse project symbols. */
        symbol?: string;
        /** Substring filter for browsing; if a namespace is selected, filters its Vars. */
        q?: string;
        /** Maximum items in each list, 1 to 200, default 40. */
        limit?: number;
        /** Zero-based page offset applied to each list. */
        offset?: number;
    },
): Promise<{root:string;indexedAt:string;namespaces:number;vars:number;errors:number;symbol?:string;kind:'project'|'namespace'|'var';definition?:{symbol:string;file:string;line:number;column:number}; lists:{name:string;total:number;items:{symbol:string;file:string;line:number;column:number}[]}[]; references:{name:string;total:number;items:{from:string;to:string;file:string;line:number;column:number}[]}[]}> {
    const fs=await import('node:fs/promises');
    const w=await ctx.fns.workspace.get({});
    if(!opts.root&&w.host)throw Error('Use a local workspace');
    const root=opts.root??await fs.realpath(w.dir);
    const i=(ctx.state as any).clojureProjectIndexes?.get(root);
    if(!i)throw Error('No snapshot. Run clojureRepl.indexProject in the project workspace first.');
    const symbol=opts.symbol?.trim().slice(0,240)||undefined;
    const q=opts.q?.trim().toLowerCase().slice(0,240)??'';
    const limit=Math.max(1,Math.min(200,Math.trunc(opts.limit??40)||40));
    const offset=Math.max(0,Math.trunc(opts.offset??0)||0);
    const page=<T>(name:string,rows:T[])=>({name,total:rows.length,items:rows.slice(offset,offset+limit)});
    const find=(map:Map<string,any>,prefix?:string)=>[...map.keys()].filter(s=>(!prefix||s.startsWith(prefix))&&s.toLowerCase().includes(q)).sort().map(s=>map.get(s));
    const refs=(k:string)=>i.edges.get(k+symbol)??[];
    const kind=!symbol?'project':symbol.includes('/')?'var':'namespace';
    const definition=symbol?(kind==='var'?i.vars:i.defs).get(symbol):undefined;
    const lists=kind==='project'?[page('Namespaces',find(i.defs)),...(q?[page('Vars',find(i.vars))]:[])]:kind==='namespace'?[page('Vars',find(i.vars,symbol+'/'))]:[];
    const references=kind==='project'?[]:[page('Referenced by',refs(kind==='var'?'in:':'module-in:')),page('References',refs(kind==='var'?'out:':'module-out:')),...(kind==='namespace'?[page('Required by',refs('in:')),page('Requires',refs('out:'))]:[])];
    return {...i.info,symbol,kind,definition,lists,references};
}
