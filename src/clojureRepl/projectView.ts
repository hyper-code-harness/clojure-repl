/**
 * Browses Clojure namespaces and relationships in Canvas
 *
 * Displays an indexed project as a browsable workspace with namespace and Var links, reference sites and definition locations.
 * @view
 * @param opts.root Project root returned by indexProject.
 * @param opts.symbol Namespace or qualified Var to inspect.
 * @param opts.q Substring to filter visible definitions.
 * @param opts.offset Page offset.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Project root returned by indexProject. */
        root: string;
        /** Namespace or qualified Var to inspect. */
        symbol?: string;
        /** Substring to filter visible definitions. */
        q?: string;
        /** Page offset. */
        offset?: number;
    },
): Promise<string> {
    const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    const {root,symbol,q,offset=0}=opts;
    const here='/rpc/clojureRepl.projectView';
    const fetchAttrs=' hx-target="#clj-project" hx-select="#clj-project" hx-swap="outerHTML"';
    const rpc=(params:Record<string,unknown>)=>esc(ctx.fns.rpc.url({fn:'clojureRepl.projectView',params:{root,...params}}));
    const nav=(href:string,label:string)=>'<a href="'+href+'" hx-get="'+href+'"'+fetchAttrs+'>'+label+'</a>';
    const ref=(s:string)=>nav(rpc({symbol:s}),'<code>'+esc(s)+'</code>');
    const source=(file:string,line:number)=>{const label='<code>'+esc(file)+':'+line+'</code>';return '<a target="_blank" rel="noopener" href="'+esc(ctx.fns.rpc.url({fn:'clojureRepl.projectSource',params:{root,file,line}}))+'">'+label+'</a>';};
    let data:Awaited<ReturnType<typeof ctx.fns.clojureRepl.projectInfo>>;
    try { data=await ctx.fns.clojureRepl.projectInfo({root,symbol,q,offset,limit:25}); }
    catch { return '<section id="clj-project"><p>No index available. Run <code>clojureRepl.indexProject</code> in the project workspace.</p></section>'; }
    const list=(name:string,total:number,rows:string)=>'<section style="margin:1rem 0"><h3>'+esc(name)+' · '+total+'</h3>'+(rows?'<ul style="padding-left:1.2rem;overflow-wrap:anywhere">'+rows+'</ul>':'<p>No results on this page.</p>')+'</section>';
    const defs=data.lists.map(g=>list(g.name,g.total,g.items.map(r=>'<li>'+ref(r.symbol)+' <small>'+source(r.file,r.line)+'</small></li>').join(''))).join('');
    const refs=data.references.map(g=>list(g.name,g.total,g.items.map(r=>'<li style="margin:.45rem 0">'+ref(r.from)+' → '+ref(r.to)+'<br><small>'+source(r.file,r.line)+'</small></li>').join(''))).join('');
    const pages=(offset>0?nav(rpc({symbol,q,offset:Math.max(0,offset-25)}),'← Previous'):'')+' '+([...data.lists,...data.references].some(g=>g.total>offset+25)?nav(rpc({symbol,q,offset:offset+25}),'Next →'):'');
    return '<section id="clj-project" style="max-width:62rem;margin:auto;padding:1rem"><p>'+nav(rpc({}),'Project overview')+'</p><h2>'+esc(data.symbol??root.split('/').pop()??'Clojure project')+'</h2><p>'+data.namespaces+' namespaces · '+data.vars+' Vars · indexed '+esc(data.indexedAt.slice(0,16).replace('T',' '))+' UTC</p><form method="get" action="'+here+'" hx-get="'+here+'"'+fetchAttrs+'><input type="hidden" name="root" value="'+esc(root)+'">'+(symbol?'<input type="hidden" name="symbol" value="'+esc(symbol)+'">':'')+'<label>Find namespace or Var <input class="input" name="q" value="'+esc(q??'')+'" maxlength="240"></label> <button class="btn">Search</button></form>'+(data.definition?'<p>Definition: '+source(data.definition.file,data.definition.line)+'</p>':'')+defs+refs+'<p>'+pages+'</p><small>Static references only. Dynamic dispatch is not inferred.</small></section>';
}
