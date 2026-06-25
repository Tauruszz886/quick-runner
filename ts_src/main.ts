declare function require(this: void, path: string): unknown

declare const _G: { require: (this: void, path: string) => unknown }

print("ts Code")
const luaRequire = _G.require
const startModule = luaRequire("project/ts_out/game/zlj/runtime/start") as { startQuickRunnerRuntime: (this: void) => void }
const startQuickRunnerRuntime = startModule.startQuickRunnerRuntime
startQuickRunnerRuntime()
