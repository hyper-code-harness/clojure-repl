---
name: clojure-repl
description: Evaluate Clojure forms in the local project nREPL managed by hyperd.
---

# Clojure REPL

In a registered local workspace call `clojureRepl.eval({ code })`.
It uses the stock nREPL client and a private Unix socket; there is no TCP listener.
Values and status are returned as EDN along with any captured stdout/stderr.
Pass `keepSession: true` to get an nREPL session ID, then pass it as `sessionId`
to preserve REPL bindings and namespace. Sessions expire when the server restarts.
For long-running forms use another workflow: the client has a deadline and a
client timeout does not guarantee the evaluation stopped on the server.

## Setup

Register trusted local workspaces explicitly. Create `~/.hyper/clojure-repl.json`
with permissions `0600`. Example:

```json
{"workspaces":{"/absolute/path/to/project":{"socket":"/absolute/private/dir/repl.sock","clojure":"clojure"}}}
```

The socket directory must be owned by your user and mode `0700`. Start nREPL
using a Unix socket (e.g. `clojure -M:nrepl -m nrepl.cmdline --socket …`),
or embed it in the application JVM. The project needs a `:nrepl` alias with
nREPL available and no `:main-opts`; the client also uses Cheshire on the
project classpath. `evalForm` uses Edamame available in the target JVM.
Optional `javaHome` supplies an absolute JDK path. Never register an untrusted
workspace: nREPL evaluates with the developer process's privileges.

## Live development operations

Use clojureRepl.request with op describe to discover server capabilities. Edit and save a source file, then call request with op load-file and path src/demo/tasks_view.clj to load it into the running JVM. To replace just one function, use op eval with ns demo.tasks-view and its new defn as code. File loading re-evaluates top-level forms and does not remove vars deleted from the file. Neither operation restarts http-kit or PostgreSQL.

Use lookup (symbol is a var name), completions (symbol is a prefix), clone, ls-sessions and close for tooling. Pass the new-session ID from clone as sessionId. To interrupt a running request in a retained session, pass its id as interruptId along with sessionId. Inspect each response in messages for status, value, err and out. Request timeouts do not imply that server-side evaluation stopped. CIDER middleware is not installed; these are stock nREPL operations.

For JavaScript data instead of EDN text, use `clojureRepl.request({ op: "eval", code: "{:ok true}", format: "json" })`. Read `messages` entries with an own `value` property (it can be `null`); `out`, `err` and `status` remain separate. This uses Cheshire on the server. Use EDN if exact Clojure types or numbers beyond JavaScript’s safe integer range matter.

## Shortcuts used on Mini Hyper

- `evalForm({ path: "src/demo/greeting.clj", symbol: "greet" })` evaluates one top-level form in its loaded namespace. You can use a one-based `line` instead of `symbol`.
- `applyAndTest({ path, oldText, newText, tests, rollbackOnFailure: true })` previews an exact change and returns `revision`. To apply, repeat the same call with that revision. It loads the changed source and specified test files, then runs clojure.test in the live JVM. Rollback restores source and reloads it; neither rollback nor interrupt undoes side effects. Reloading does not remove deleted Vars.
- `namedSession({ name, action: "eval", id, code, format: "json" })` keeps REPL bindings and returns values, stdout, stderr and status separately. To stop a running evaluation, use `namedSession({ name, action: "interrupt", id })` with its exact ID in another call. If interrupted, partial output may be omitted. Close sessions with `action: "close"`.
