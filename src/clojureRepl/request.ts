/**
 * Runs standard nREPL tooling operations against the live Clojure app
 *
 * Discovers server operations, evaluates forms, loads a saved workspace source file, looks up or completes symbols, and manages sessions. Use a cloned session and a unique id when you may need to interrupt a running request. CIDER middleware is not required.
 * @param opts.op Standard nREPL operation.
 * @param opts.code Form or forms for eval.
 * @param opts.path Project-relative source file for load-file.
 * @param opts.ns Existing namespace for eval, lookup or completions.
 * @param opts.symbol Symbol to look up or prefix to complete.
 * @param opts.sessionId Session to resume, clone, interrupt or close.
 * @param opts.id Request identifier; pass the same value as interruptId on an interrupt request.
 * @param opts.interruptId Identifier of the running request to interrupt.
 * @param opts.format Use json to decode eval or load-file values into JavaScript data. Defaults to edn.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Standard nREPL operation. */
        op: "describe" | "eval" | "load-file" | "lookup" | "completions" | "clone" | "ls-sessions" | "interrupt" | "close";
        /** Form or forms for eval. */
        code?: string;
        /** Project-relative source file for load-file. */
        path?: string;
        /** Existing namespace for eval, lookup or completions. */
        ns?: string;
        /** Symbol to look up or prefix to complete. */
        symbol?: string;
        /** Session to resume, clone, interrupt or close. */
        sessionId?: string;
        /** Request identifier; pass the same value as interruptId on an interrupt request. */
        id?: string;
        /** Identifier of the running request to interrupt. */
        interruptId?: string;
        /** Value format for eval or load-file. Defaults to edn. */
        format?: "edn" | "json";
    },
): Promise<{ id: string; messages: Record<string, unknown>[] }> {
    const { dir: cwd, socket, clojure, javaHome } = await ctx.fns.clojureRepl.localTarget({});
    const { op } = opts;

    if (!["describe", "eval", "load-file", "lookup", "completions", "clone", "ls-sessions", "interrupt", "close"].includes(op)) throw new Error("Unsupported operation");
    if (opts.format !== undefined && opts.format !== "edn" && opts.format !== "json") throw new Error("Unsupported value format");
    if (opts.format === "json" && op !== "eval" && op !== "load-file") throw new Error("JSON value format requires eval or load-file");
    const id = opts.id ?? crypto.randomUUID();
    if (!/^[\w.-]{1,128}$/.test(id)) throw new Error("Invalid request id");
    const msg: Record<string, string> = { op, id };
    if (opts.format === "json") msg["nrepl.middleware.print/print"] = "cheshire.core/generate-stream";
    if (opts.sessionId !== undefined) {
        if (!/^[0-9a-f-]{36}$/.test(opts.sessionId)) throw new Error("Invalid nREPL session ID");
        msg.session = opts.sessionId;
    }
    if ((op === "interrupt" || op === "close") && !msg.session) throw new Error("sessionId is required");
    if (op === "interrupt" && opts.interruptId) msg["interrupt-id"] = opts.interruptId;
    if (opts.ns && ["eval", "lookup", "completions"].includes(op)) msg.ns = opts.ns;
    if (op === "eval") {
        if (typeof opts.code !== "string" || !opts.code.trim()) throw new Error("code is required");
        msg.code = opts.code;
    }
    if (op === "lookup" || op === "completions") {
        if (typeof opts.symbol !== "string" || !opts.symbol.trim()) throw new Error("symbol is required");
        msg[op === "lookup" ? "sym" : "prefix"] = opts.symbol;
    }
    if (op === "load-file") {
        if (typeof opts.path !== "string" || !/^(src|test)\/.+\.cljc?$/.test(opts.path)) throw new Error("Use a Clojure source path under src/ or test/");
        const fs = await import("node:fs/promises");
        const path = await fs.realpath(cwd + "/" + opts.path);
        if (![cwd + "/src/", cwd + "/test/"].some(prefix => path.startsWith(prefix))) throw new Error("Source is outside the project");
        const file = Bun.file(path);
        if (file.size > 64_000) throw new Error("Source exceeds 64 KB");
        msg.file = await file.text();
        msg["file-path"] = path.slice(cwd.length + 1).replace(/^(src|test)\//, "");
        msg["file-name"] = path.split("/").pop()!;
    }
    const payload = JSON.stringify(msg);
    if (Buffer.byteLength(payload) > 96_000) throw new Error("Request exceeds 96 KB");
    const client = `(require '[nrepl.core :as n] '[nrepl.transport :as t] '[cheshire.core :as json])
    (with-open [transport (n/connect :socket (System/getenv "HYPER_NREPL_SOCKET"))]
      (let [client (n/client transport 13000)
            request (json/parse-string-strict (slurp *in*) true)]
        (when-not (reduce (fn [_ response]
                           (println (json/generate-string response))
                           (flush)
                           (boolean (some #{"done"} (:status response))))
                         false (if (= "interrupt" (:op request))
                                 (do (t/send transport request)
                                     (loop [responses []]
                                       (if-let [response (t/recv transport 13000)]
                                         (let [responses (conj responses response)]
                                           (if (= (:id request) (:id response)) responses (recur responses)))
                                         responses)))
                                 (n/message client request)))
          (throw (ex-info "nREPL did not finish; the operation may still be running" {})))))`;
    const proc = Bun.spawn([clojure, "-M:nrepl", "-e", client], {
        cwd, env: { ...process.env, ...(javaHome ? { JAVA_HOME: javaHome } : {}),
            HYPER_NREPL_SOCKET: socket },
        stdin: new Blob([payload]), stdout: "pipe", stderr: "pipe",
    });
    const deadline = setTimeout(() => proc.kill(), 22000);
    const read = async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let text = "", size = 0;
        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) return text + decoder.decode();
                size += value.length;
                if (size > 128_000) { proc.kill(); throw new Error("nREPL output exceeded 128 KB"); }
                text += decoder.decode(value, { stream: true });
            }
        } finally { reader.releaseLock(); }
    };
    try {
        const [out, err, exit] = await Promise.all([read(proc.stdout), read(proc.stderr), proc.exited]);
        if (exit !== 0) throw new Error((err.trim().slice(0, 1400) || "nREPL client stopped") + " (request " + id + ")");
        const messages: Record<string, unknown>[] = out.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
        if (opts.format === "json") {
            for (const message of messages) {
                if (typeof message.value !== "string") continue;
                try { message.value = JSON.parse(message.value); }
                catch { throw new Error("nREPL returned an invalid JSON value (request " + id + ")"); }
            }
        }
        return { id, messages };
    } finally { clearTimeout(deadline); }
}
