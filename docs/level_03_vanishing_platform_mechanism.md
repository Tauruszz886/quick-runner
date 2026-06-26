# 第03关链式渐隐地砖机关

本文档记录第 03 关 12 块链式渐隐地砖的运行时结构、场景 KV 接入和可复用 API。后续项目需要类似“踩地砖后描边提示、渐隐、消失、恢复、链式触发”的逻辑时，优先复用这里的模块结构。

## 代码结构

- `ts_src/zlj/runtime/runtime_ninth_mechanism.ts`
  - 兼容入口。仍负责扫描绑定 `third_vanishing_platform` / `third_vanishing_trigger`，并保留第 9 关旧消失平台逻辑。
  - 第 03 关逻辑只通过第三关模块入口调用，不再把时序和引擎 API 直接写在这个文件里。
- `ts_src/zlj/runtime/third_level/vanishing_platform_config.ts`
  - 地砖名单、链路分组、时间参数、颜色、透明度分段、描边参数。
- `ts_src/zlj/runtime/third_level/vanishing_platform_engine.ts`
  - 引擎 API 封装：透明度、模型显示、物理显示、物理启用、碰撞、颜色、角色描边。
- `ts_src/zlj/runtime/third_level/vanishing_platforms.ts`
  - 机关流程：链式触发、单块地砖循环、逐帧渐隐、消失、恢复、死亡 reset 后复位。

## 当前时序

- 链式间隔：`0.6s`
- 触发后等待：`0.3s`
- 渐隐：`30` 帧，按当前项目口径约 `1s`
- 透明度分段：每 `10` 帧减少 `1/3`
  - `1 -> 2/3 -> 1/3 -> 0`
- 渐隐完成后消失：`2s`
- 消失后恢复：模型显示、透明度、颜色、物理、碰撞全部恢复。

对应配置在 `vanishing_platform_config.ts`：

```ts
export const THIRD_CHAIN_DELAY_SECONDS = 0.6
export const THIRD_WAIT_BEFORE_FADE_SECONDS = 0.3
export const THIRD_FADE_SECONDS = 1
export const THIRD_FADE_FRAMES = 30
export const THIRD_FADE_STEP_FRAMES = 10
export const THIRD_DISAPPEAR_SECONDS = 2
export const THIRD_FADE_STEP_OPACITY: readonly number[] = [1, 2 / 3, 1 / 3, 0]
```

## 12 块地砖链路

当前链路按行分为 4 组，每组 3 块，从被踩中的地砖开始向后触发：

```ts
[
  ["第03关_dxf_848_24x17_1875", "第03关_dxf_844_24x17_1875", "第03关_dxf_840_24x17_1875"],
  ["第03关_dxf_84C_24x17_1875", "第03关_dxf_858_24x17_1875", "第03关_dxf_85C_24x17_1875"],
  ["第03关_dxf_850_24x17_1875", "第03关_dxf_86C_24x17_1875", "第03关_dxf_860_24x17_1875"],
  ["第03关_dxf_854_24x17_1875", "第03关_dxf_868_24x17_1875", "第03关_dxf_864_24x17_1875"],
]
```

## 场景 KV 接入

运行时通过 `runtime_scene_scan.ts` 扫描 `QR_地图_ROOT` 下带 `QRRole` 的单位。第 03 关渐隐地砖需要两类单位。

地砖本体：

```json
{
  "QRRole": "third_vanishing_platform",
  "QRModule": 3,
  "QRComponent": "dxf_840_24x17_1875",
  "QRRuntimeName": "第03关_dxf_840_24x17_1875"
}
```

触发区：

```json
{
  "QRRole": "third_vanishing_trigger",
  "QRModule": 3,
  "QRComponent": "dxf_840_24x17_1875_渐隐触发区",
  "QRRuntimeName": "第03关_dxf_840_24x17_1875_渐隐触发区",
  "QRTargetComponent": "dxf_840_24x17_1875",
  "QRTargetRuntimeName": "第03关_dxf_840_24x17_1875"
}
```

接入点在 `runtime_terrain.ts`：

- `third_vanishing_platform` -> `registerVanishingPlatformBinding(unit, name)`
- `third_vanishing_trigger` -> `registerVanishingPlatformTriggerBinding(unit, name, targetRuntimeName)`

有 `QRRole` 且参与机关挂钩的场景组件，需要关闭组件性能优化，避免运行时 API 对单位模型、物理或触发器状态的修改不稳定。

## 运行时行为

单块地砖触发后：

1. 如果该地砖正在渐隐或已经消失，本次触发跳过。
2. 打开红色描边，表示玩家已触发本轮流程。
3. 恢复并确认物理状态：`set_model_physic_visible(true)`、`set_physics_active(true)`、`set_physic_enable(true)`、`enable_collision(true)`。
4. 等待 `0.3s`。
5. 逐帧渐隐，按 `30` 帧分成 3 段降低透明度和颜色。
6. 透明到 `0` 后，先用 `Role.disable_unit_outline(unit)` 清掉红框，再调用 `set_model_physic_visible(false)` 让地砖消失。
7. 消失 `2s` 后恢复模型显示、透明度、蓝色、物理和碰撞。

玩家掉坑死亡时，`PLAYER_DIED_TO_REBIRTH` 会触发 reset：

- 所有已注册地砖 `generation += 1`，打断旧的延迟回调。
- 清除红框。
- 恢复模型显示、透明度、颜色、物理和碰撞。

## 使用到的引擎 API

地砖单位：

- `set_opacity(Fix32)`：渐隐和恢复透明度。
- `set_paint_area_color(PaintArea, Color)`：蓝色初始态和渐隐颜色。
- `set_model_visible(boolean)`：恢复时确保模型可见。
- `set_model_physic_visible(boolean)`：消失/恢复的主 API。
- `set_physics_active(boolean)`、`set_physic_enable(boolean)`、`enable_collision(boolean)`：恢复后可站立的物理兜底。

角色：

- `Role.set_unit_outline(unit, width, color)`：流程内显示红色边框。
- `Role.disable_unit_outline(unit)`：消失、恢复、reset 时清除红色边框。

调度：

- `LuaAPI.call_delay_time(Fix32, callback)`：等待、链式间隔、消失后恢复。
- `LuaAPI.call_delay_frame(1, callback)`：逐帧渐隐。

## 复用方式

复用到其他项目或其他关卡时：

1. 复制 `third_level/vanishing_platform_config.ts`、`third_level/vanishing_platform_engine.ts`、`third_level/vanishing_platforms.ts` 的结构。
2. 修改配置文件中的链路分组、地砖名字、颜色和时间参数。
3. 场景单位按“地砖本体 + 触发区”写入 `QRRole` 和 `QRTargetRuntimeName`。
4. 在项目的场景扫描绑定中心，把平台和触发区分别接到注册函数。
5. 玩家死亡或关卡重置时，调用 reset 入口恢复地砖状态。
6. 确认参与机关挂钩的组件关闭性能优化。

关键入口：

```ts
registerVanishingPlatformBinding(unit, runtimeName)
registerVanishingPlatformTriggerBinding(triggerUnit, triggerRuntimeName, targetRuntimeName)
startThirdVanishingPlatformChain(platform, source, platformsByName)
resetThirdVanishingPlatform(platform, source)
```

如果目标项目没有 `EventBus`、`TriggerHub`、`safeCall`，需要先接入 platform 通用模块，或用项目自己的等价封装替换。
