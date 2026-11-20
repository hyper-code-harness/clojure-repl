/**
 * Builds a static Clojure project index with clj-kondo
 *
 * Indexes selected source folders in the local workspace. Uses the native clj-kondo CLI on PATH (or an explicitly supplied executable). Does not connect to nREPL. Re-run after edits; the previous snapshot remains available if indexing fails.
 * @param opts.paths Workspace-relative source directories. Defaults to existing src and test directories.
 * @param opts.executable Optional absolute path to a trusted clj-kondo executable.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Workspace-relative source directories. Defaults to existing src and test directories. */
        paths?: string[];
        /** Optional absolute path to a trusted clj-kondo executable. */
        executable?: string;
    },
): Promise<{root:string;indexedAt:string;namespaces:number;vars:number;errors:number}> {
    const fs=await import('node:fs/promises');
    const p=await import('node:path');
    const w=await ctx.fns.workspace.get({});
    if(w.host)throw Error('Indexing currently supports local workspaces only');
    const root=await fs.realpath(w.dir);
    const paths=opts.paths??(await Promise.all(['src','test'].map(async d=>(await fs.stat(p.join(root,d)).catch(()=>null))?.isDirectory()?d:null))).filter((d):d is string=>!!d);
    if(!Array.isArray(paths)||!paths.length||paths.length>40)throw Error('Provide 1 to 40 source directories');
    const dirs=await Promise.all(paths.map(async d=>{
     if(typeof d!=='string'||p.isAbsolute(d)||!d||d.split(p.sep).includes('..'))throw Error('Use workspace-relative source directories');
     const abs=await fs.realpath(p.resolve(root,d));
     if(abs!==root&&!abs.startsWith(root+p.sep))throw Error('Source directory is outside workspace');
     if(!(await fs.stat(abs)).isDirectory())throw Error('Source path must be a directory');
     return abs;
    }));
    const exe=opts.executable??Bun.which('clj-kondo');
    if(!exe||!p.isAbsolute(exe))throw Error('Install clj-kondo on PATH or provide its absolute executable path');
    const proc=Bun.spawn([exe,'--lint',...dirs,'--cache','false','--config','{:output {:format :json} :analysis true}'],{cwd:root,stdout:'pipe',stderr:'ignore'});
    const timer=setTimeout(()=>proc.kill(),60000);
    let result:any;
    try {
     const reader=proc.stdout.getReader();const decoder=new TextDecoder();let text='',size=0;
     try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>100_000_000)throw Error('clj-kondo output exceeds 100 MB');text+=decoder.decode(value,{stream:true});}}finally{reader.releaseLock();}
     const code=await proc.exited;if(![0,2,3].includes(code))throw Error('clj-kondo exited with status '+code);
     result=JSON.parse(text+decoder.decode());
    } finally {clearTimeout(timer);if(proc.exitCode===null)proc.kill();}
    const a=result.analysis;
    if(!a||!Array.isArray(a['namespace-definitions']))throw Error('No clj-kondo analysis received');
    const key=(ns:string,name:string)=>ns+'/'+name;
    const files=new Set<string>();
    const location=(r:any)=>{
     const file=p.relative(root,p.resolve(root,r.filename));
     if(file&&!p.isAbsolute(file)&&!file.startsWith('..'+p.sep))files.add(file);
     return {file,line:r['name-row']??r.row,column:r['name-col']??r.col};
    };
    const defs=new Map<string,any>();
    const vars=new Map<string,any>();
    for(const r of a['namespace-definitions'])if(r.name&&r.filename)defs.set(r.name,{symbol:r.name,...location(r)});
    for(const r of a['var-definitions']??[])if(r.ns&&r.name&&r.filename)vars.set(key(r.ns,r.name),{symbol:key(r.ns,r.name),namespace:r.ns,...location(r)});
    const edges=new Map<string,any[]>();
    const add=(kind:string,from:string,to:string,r:any)=>{
     const site={kind,from,to,...location(r)};
     for(const k of ['in:'+to,'out:'+from]){const rows=edges.get(k)??[];rows.push(site);edges.set(k,rows);}
    };
    for(const r of a['namespace-usages']??[])if(r.from&&r.to&&r.filename&&r.from!==r.to)add('require',r.from,r.to,r);
    for(const r of a['var-usages']??[])if(r.from&&r.to&&r.name&&r.filename&&r.to!=='<unknown-namespace>'){
     const from=r['from-var']?key(r.from,r['from-var']):r.from;
     const to=key(r.to,r.name);add('reference',from,to,r);
     const site={kind:'var',from,to,...location(r)};
     if(r.from!==r.to)for(const k of ['module-in:'+r.to,'module-out:'+r.from]){const rows=edges.get(k)??[];rows.push(site);edges.set(k,rows);}
    }
    const info={root,indexedAt:new Date().toISOString(),namespaces:defs.size,vars:vars.size,errors:Number(result.summary?.error??0)};
    const state=ctx.state as any;
    const indexes:Map<string,any>=state.clojureProjectIndexes??=new Map();
    indexes.delete(root);indexes.set(root,{info,defs,vars,edges,files});if(indexes.size>4)indexes.delete(indexes.keys().next().value!);
    return info;
}
