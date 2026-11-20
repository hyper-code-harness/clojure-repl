/**
 * Resolves the configured private Unix socket for the calling local agent workspace
 *
 * Reads an owner-only config from ~/.hyper/clojure-repl.json, matches the current local workspace and verifies a private socket. No credentials are read or returned.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<{ dir: string; socket: string; clojure: string; javaHome?: string }> {
    const ws=ctx.fns.workspace.get({});
    if ((!session?.agent && !session?.agentId) || ws.host) throw new Error("A local agent session is required");
    const fs=await import("node:fs/promises");
    const os=await import("node:os");
    const path=await import("node:path");
    const config=path.join(os.homedir(),".hyper","clojure-repl.json");
    const info=await fs.lstat(config);
    const uid=process.getuid?.();
    if (!info.isFile() || info.size>32768 || (info.mode&0o077)!==0 || (uid!==undefined&&info.uid!==uid)) throw new Error("Clojure REPL config must be a private regular file");
    const data=JSON.parse(await fs.readFile(config,"utf8"));
    const dir=await fs.realpath(ws.dir);
    const item=data.workspaces?.[dir];
    if(!item || typeof item.socket!=="string" || !path.isAbsolute(item.socket))throw new Error("Register this local workspace in ~/.hyper/clojure-repl.json");
    const socketDir=await fs.realpath(path.dirname(item.socket));
    const socket=path.join(socketDir,path.basename(item.socket));
    const [parent, st]=await Promise.all([fs.stat(socketDir),fs.lstat(socket)]);
    if(!st.isSocket() || (parent.mode&0o077)!==0 || (uid!==undefined&&(parent.uid!==uid||st.uid!==uid))) throw new Error("Expected an owner-only nREPL socket directory");
    const {clojure="clojure",javaHome}=item;
    if(typeof clojure!=="string"||(clojure!=="clojure"&&!path.isAbsolute(clojure))) throw new Error("Invalid Clojure executable");
    if(javaHome!==undefined&&(typeof javaHome!=="string"||!path.isAbsolute(javaHome))) throw new Error("Invalid JAVA_HOME");
    return {dir,socket,clojure,javaHome};
}
