/**
 * Adds a Maven library to the running project JVM without restarting
 *
 * Uses Clojure 1.12 add-lib in the live nREPL and optionally requires a namespace. Uses explicit Maven coordinates only. Also declare the dependency in deps.edn if it should survive restart. Already loaded libraries are not upgraded in place.
 * @param opts.lib Qualified Maven library symbol, e.g. org.clojure/data.json.
 * @param opts.version Explicit Maven version, e.g. 2.5.1.
 * @param opts.namespace Namespace to require after loading.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Qualified Maven library symbol, e.g. org.clojure/data.json. */
        lib: string;
        /** Explicit Maven version, e.g. 2.5.1. */
        version: string;
        /** Namespace to require after loading. */
        namespace?: string;
    },
): Promise<{ id: string; messages: Record<string, unknown>[] }> {
    if (typeof opts.lib !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(opts.lib)) throw new Error("Expected group/artifact");
    if (typeof opts.version !== "string" || !/^[0-9][A-Za-z0-9_.+-]{0,79}$/.test(opts.version)) throw new Error("Expected an explicit Maven version");
    if (opts.namespace !== undefined && !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(opts.namespace)) throw new Error("Invalid Clojure namespace");
    const requireNs = opts.namespace ? "(require '" + opts.namespace + ")" : "";
    return await ctx.fns.clojureRepl.request({op: "eval", ns: "user", format: "json", code: "(do (require 'clojure.repl.deps) (clojure.repl.deps/add-lib '" + opts.lib + " {:mvn/version " + JSON.stringify(opts.version) + "}) " + requireNs + " {:library " + JSON.stringify(opts.lib) + " :requested-version " + JSON.stringify(opts.version) + "})"});
}
