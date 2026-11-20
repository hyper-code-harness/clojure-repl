/**
 * Shows a source line from an indexed Clojure project
 *
 * Renders a bounded source excerpt from an indexed local project. Resolves paths and rejects files outside its root.
 * @view
 * @param opts.root Canonical project root returned by indexProject.
 * @param opts.file Relative Clojure source filename.
 * @param opts.line One-based source line.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Canonical project root returned by indexProject. */
        root: string;
        /** Relative Clojure source filename. */
        file: string;
        /** One-based source line. */
        line: number;
    },
): Promise<string> {
    const fs=await import('node:fs/promises');const p=await import('node:path');
    const {root,file,line}=opts;
    const index=(ctx.state as any).clojureProjectIndexes?.get(root);
    if(!index?.files?.has(file)||!Number.isSafeInteger(line)||line<1)throw Error('Not an indexed source location');
    const path=await fs.realpath(p.resolve(root,file));
    if(!path.startsWith(root+p.sep)||(await fs.stat(path)).size>4_000_000)throw Error('Source outside workspace or too large');
    const lines=(await Bun.file(path).text()).split(/\r?\n/);
    const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    const start=Math.max(0,line-6);
    return '<h2><code>'+esc(file)+':'+line+'</code></h2><pre>'+lines.slice(start,line+5).map((s,i)=>{const n=start+i+1;const content=n+'  '+esc(s);return n===line?'<mark>'+content+'</mark>':content;}).join('\n')+'</pre>';
}
