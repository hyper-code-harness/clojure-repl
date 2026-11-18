/**
 * Says hello from the Clojure REPL plugin — the starter function; replace it with the first real one
 *
 * Use to check that the plugin is mounted and callable. It reads nothing and changes nothing.
 * @param opts.to Who to greet. @default "world"
 */
export default async function (_ctx: Context, _session: Session | null, opts: {
    /** Who to greet. @default "world" */
    to?: string;
}): Promise<{ plugin: string; message: string }> {
    const to = String(opts?.to ?? "").trim() || "world";
    return { plugin: "clojure-repl", message: `Hello, ${to}!` };
}
