---
name: clojure-repl
description: "Evaluate Clojure forms in the local project nREPL managed by hyperd."
---

# Clojure REPL

Evaluate Clojure forms in the local project nREPL managed by hyperd.

Write here what the plugin is for, what it needs (accounts, settings, secrets) and what it must never do.
Keep signatures out of this file: `plugins.read({ name: "clojure-repl" })` shows the functions from their JSDoc.

## Develop

- Functions live in `src/clojureRepl/<fn>.ts`, one per file: `ctx.fns.clojureRepl.<fn>({ ... })`. A save goes live at once.
- Tests: `bun <hyper-code>/script/plugin-test.ts .` in this folder.
- Publish: `plugins.publish({ name: "clojure-repl", repo })` — first release to a git repository of yours. Later versions: `plugins.edit`, commit, `plugins.release`.
