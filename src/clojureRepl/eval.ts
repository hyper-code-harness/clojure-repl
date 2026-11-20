/**
 * Evaluates Clojure forms in the configured local nREPL
 *
 * Calls the stock nREPL client over a private Unix socket. Only agents in a registered local workspace may call it. Returns combined nREPL values, output and status as EDN. Sessions are ephemeral unless explicitly retained or resumed.
 * @param opts.code Clojure forms to evaluate.
 * @param opts.keepSession Keep a newly created nREPL session for later calls.
 * @param opts.sessionId Session ID from an earlier call to resume bindings and namespace.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Clojure forms to evaluate. */
        code: string;
        /** Keep a newly created nREPL session for later calls. */
        keepSession?: boolean;
        /** Session ID from an earlier call to resume bindings and namespace. */
        sessionId?: string;
    },
): Promise<{ edn: string; sessionId: string | null }> {
    const { dir: directory, socket, clojure, javaHome } = await ctx.fns.clojureRepl.localTarget({});
    if (typeof opts.code !== "string" || !opts.code.trim() || Buffer.byteLength(opts.code) > 64_000) throw new Error("Expected 1–64000 bytes of Clojure code");
    if (opts.sessionId !== undefined && !/^[0-9a-f-]{36}$/.test(opts.sessionId)) throw new Error("Invalid nREPL session ID");
    const client = `(require '[nrepl.core :as n])
    (let [socket (System/getenv "HYPER_NREPL_SOCKET")
          sid (System/getenv "HYPER_NREPL_SESSION")
          keep (System/getenv "HYPER_NREPL_KEEP")]
      (with-open [transport (n/connect :socket socket)]
        (let [client (n/client transport 12000)
              retained (or (not-empty sid) (when (= "yes" keep) (n/new-session client)))
              request (cond-> {:op "eval" :code (slurp *in*)} retained (assoc :session retained))
              result (n/combine-responses (n/message client request))]
          (when-not (contains? (:status result) "done")
            (throw (ex-info "Timed out waiting for nREPL; eval may still be running" {})))
          (println (or retained "-"))
          (prn (dissoc result :id :session)))))`;
    const proc = Bun.spawn([clojure, "-M:nrepl", "-e", client], {
        cwd: directory, env: {
            ...process.env,
            ...(javaHome ? { JAVA_HOME: javaHome } : {}),
            HYPER_NREPL_SOCKET: socket,
            HYPER_NREPL_SESSION: opts.sessionId ?? "",
            HYPER_NREPL_KEEP: opts.keepSession ? "yes" : "no",
        },
        stdin: new Blob([opts.code]), stdout: "pipe", stderr: "pipe",
    });
    const deadline = setTimeout(() => proc.kill(), 22000);
    const readBounded = async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let text = "", size = 0;
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) return text + decoder.decode();
                size += value.length;
                if (size > 128_000) { proc.kill(); throw new Error("nREPL client output exceeded 128 KB"); }
                text += decoder.decode(value, { stream: true });
            }
        } finally { reader.releaseLock(); }
    };
    try {
        const [out, err, exit] = await Promise.all([readBounded(proc.stdout), readBounded(proc.stderr), proc.exited]);
        if (exit !== 0) throw new Error(err.trim().slice(0, 2000) || `nREPL client exited (${exit}); eval may still be running`);
        const newline = out.indexOf("\n");
        if (newline < 0) throw new Error("Malformed nREPL client response");
        const id = out.slice(0, newline).trim();
        return { edn: out.slice(newline + 1).trim(), sessionId: id === "-" ? null : id };
    } finally { clearTimeout(deadline); }
}
