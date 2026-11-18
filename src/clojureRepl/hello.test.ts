import { expect, test } from "bun:test";
import hello from "./hello";

test("hello greets the given name, and the world by default", async () => {
    expect(await hello({} as any, null, {})).toEqual({ plugin: "clojure-repl", message: "Hello, world!" });
    expect((await hello({} as any, null, { to: " Ada " })).message).toBe("Hello, Ada!");
});
