# quick-runner 代码模块与工具说明

本文档用于快速理解 `ts_src` 下的运行时代码、`data/zlj` 关卡数据，以及 `tools` 下的编辑器/CAD 辅助脚本。

项目内跨目录、跨语言的数据耦合和后续整理计划见 `docs/coupling_cleanup_plan.md`。

## 总体运行流程

`ts_src/main.ts` 是 TypeScript 转 Lua 后的入口。它加载 `zlj/runtime/start.ts`，在 `EVENT.GAME_INIT` 时启动玩家运行时系统，并延迟绑定编辑器场景中的关卡机关。

当前 quick-runner 的主要设计是：

- 地板、墙、天花板、关卡地形等静态场景对象优先由编辑器创建和维护。
- `data/zlj/levels/*.json` 是关卡几何源数据；`terrain.ts` 是由 JSON 生成的 TS 适配层。
- 运行时机关绑定扫描 `QR_地图_ROOT` 下的场景单位，读取单位自定义 KV（例如 `QRRole`、`QRMoveZ`、`QRMoving`），再按 role 注册玩法逻辑。
- `runtime` 代码负责试玩时的逻辑：玩家速度、出生复活、掉坑死亡、追击球、移动/消失/压板/电流等机关。
- `tools/zlj_editor_scene` 负责把这些地形数据生成编辑器场景对象树，并提供校验和索引导出。

## ts_src 目录

### main.ts

`ts_src/main.ts` 只做一件事：通过 `_G.require` 加载编译后的 `project/ts_out/game/zlj/runtime/start`，然后调用 `startQuickRunnerRuntime()`。

### generated

`ts_src/generated` 是编辑器导出的自动生成数据，不建议手动修改。

- `eggitor_export.ts`：统一转导导出的数据。
- `exported_data.ts`：当前主要包含 UI 节点表，例如 `UINodes["画布0"]`。
- `exported_class.ts`：导出数据对应的类型。

## data 目录

`data` 用于存放可被多种工具读取的结构化源数据。

第 1-10 关地形源数据都维护在 `data/zlj/levels/level_XX.json`。`ts_src/zlj/levels/level_XX/terrain.ts` 由 `tools/zlj_data/generate_level_terrain.py` 生成，主要给 TypeScript 侧类型检查和旧索引入口使用。

掉坑死亡区使用单独的 `data/zlj/fall_death_zones.json` 维护。这份数据只供编辑器场景创建脚本使用，用来生成带 `QRRole="fall_death"` 的 `QR_第XX关_掉坑死亡_fall_death_XX` 触发器组件；运行时不再加载掉坑区域 TS 列表。

`data/zlj/runtime_scene_bindings.json` 暂时作为迁移输入使用：`create_editor_scene.py` 会把它写入场景单位自定义 KV。运行时不再读取它，也不再生成 `runtime_scene_bindings.ts`。等场景里的 KV 稳定后，这份 JSON 可以继续降级或删除。

### zlj/config.ts

全局配置和类型定义。

这里集中放地图尺寸、出生点、预制体 ID、运行时地板/墙/天花板参数、机关参数、颜色和日志标签。运行时和工具脚本中的很多坐标约定都与这里保持一致。

### zlj/layout.ts

负责关卡模块布局计算。

- `runtimeModuleLabel()` / `runtimeModuleName()`：生成“出生地”“第1关”这类显示名和运行时名字。
- `getRuntimeFloorForModule()`：根据关卡编号返回该关地板尺寸。
- `getRuntimeModuleCenterX()`：按出生地、第 1 关到第 10 关的顺序，计算每个模块在世界坐标里的中心 X。
- `asFixed()`：把 number 转成引擎需要的 `Fixed` 类型。

## birth 模块

`ts_src/zlj/birth` 负责玩家出生和死亡后回出生地。

- `spawn.ts`：遍历在线玩家，把角色出生点调整到 `config.ts` 中的出生坐标。
- `rebirth.ts`：配置角色复活点、自动复活、无限复活；当玩家碰到死亡触发器时，调用 `die()` 并通过 `EventBus` 发出 `PLAYER_DIED_TO_REBIRTH`。

这些逻辑是多个机关共用的基础能力。掉坑、压板、夹层、追击球、电流等都会复用这里的回出生逻辑。

## levels 模块

`ts_src/zlj/levels` 保存给 TypeScript 使用的关卡数据模块。其中一部分是由 `data/zlj` 生成的适配层。

### terrain.ts 的作用

每个 `levels/level_xx/terrain.ts` 都导出一个 `LEVEL_XX_TERRAIN` 数组。数组里的每个对象代表本关的一块平台、障碍或机关零件。

它现在是生成物，不是手写源文件。编辑器场景创建读取 `data/zlj/levels/*.json`；运行时机关绑定扫描场景单位自定义 KV。

常见字段：

| 字段 | 含义 |
| --- | --- |
| `name` | 地形块名字，通常来自 DXF/CAD 或编辑器对象名。编辑器创建脚本会拼成类似 `QR_第02关_dxf_xxx` 的对象名。 |
| `startX` / `startZ` | 这块地形在本关 160x100 局部区域内的起始坐标。 |
| `sx` / `sy` / `sz` | 地形块在 X/Y/Z 三个方向的尺寸。 |
| `baseY` | 可选，高度基准。不写时通常使用普通地砖高度。 |
| `prefabId` | 可选，指定特殊预制体。第 10 关电流块会用到。 |
| `role` | 可选，给特殊机关打标。第 4 关 `role: "fourth_compressor"` 表示压板。 |

这些文件本身不执行逻辑，而是 JSON 源数据的 TS 适配层。目前没有运行时主路径依赖它们；后续如果没有 TS 侧消费者，可以继续封存或删除。

编辑器创建脚本不再解析 `terrain.ts`。

### shared

- `shared/types.ts`：定义 `LevelTerrainSpec` 和 `LevelTerrainFrame`。
- `shared/frames.ts`：定义每个模块的地形框尺寸，目前出生地和第 1-10 关都是 `160 x 100`。

## runtime 模块

`ts_src/zlj/runtime` 是试玩时真正运行的玩法逻辑。

### start.ts

运行时入口。游戏初始化后：

- 启动速度系统。
- 隐藏旧速度 UI。
- 多次延迟调整在线玩家出生点，避免角色还没完全创建时错过设置。
- 延迟绑定编辑器场景中的机关。

### runtime_terrain.ts

运行时地形/机关绑定中心。

主要工作：

- 调用 `runtime_scene_scan.ts` 扫描 `QR_地图_ROOT` 子树。
- 读取带 `QRRole` 自定义 KV 的场景单位。
- 从场景单位自身读取 `position`、`scale` 和玩法 KV。
- 按 `QRRole -> handler` 注册对应机关逻辑。
- 不再根据 terrain 几何数据或外部组件名单创建 fallback 机关单位。
- 启动压板、第 3 关平台、第 5 关夹层、第 8 关机关、第 10 关电流、第 2 关追击球、掉坑死亡触发器等系统。

### runtime_scene_scan.ts

场景玩法组件扫描器。

它从 `QR_地图_ROOT` 开始递归遍历子单位，读取这些自定义 KV：

- `QRRole`：玩法角色，例如 `third_timed_platform`、`fourth_compressor`、`fall_death`。
- `QRModule`：所属关卡编号。
- `QRComponent`：组件短名。
- `QRRuntimeName`：运行时日志/状态名。
- `QRMoveZ`、`QRMoving`：少量角色参数。

运行时只对带 `QRRole` 的单位做特殊处理。

### runtime_structure.ts

运行时生成地图结构的旧/备用路径。

它可以创建地板、墙、天花板和调试网格。当前 quick-runner 目标是静态场景对象在编辑器里创建；`runtime_terrain.ts` 里的 `createRuntimeTiles()` 地形备用创建路径已经移除。

### runtime_speed.ts

玩家快速移动系统。

它创建 `fast_run_system`，给在线玩家添加组件，并提供速度调试面板入口。调试面板解锁按钮注册在 `runtime_dashboard_unlock.ts`。

### runtime_dashboard_unlock.ts

速度调试面板的隐藏解锁逻辑。

监听 UI 按钮“圆形金”和“圆形蓝”。当前规则是先点 A 按钮 3 次，再点 B 按钮 3 次，之后启用 fast-run dashboard。

### runtime_roles.ts

在线玩家工具函数。

- `getOnlineRoles()`：安全获取所有有效玩家角色。
- `roleKey()`：把角色转成稳定字符串 key。

### GameEvents.ts

运行时事件名常量。目前主要是 `PLAYER_DIED_TO_REBIRTH`，用于通知各机关在玩家死亡回出生后复位。

### runtime_fall_return.ts

掉坑死亡触发器。

它不再根据 terrain 自动计算空洞，也不再读取掉坑区域 TS 列表。运行时只负责给扫描到的 `QRRole="fall_death"` 场景触发器注册进入事件；玩家进入触发器后调用 `eliminateUnitAndRebirthAtBirth()` 回出生地。

### runtime_second_chaser.ts

第 2 关追击球。

它查询或匹配编辑器里的追击球，配置物理属性，让球锁定附近玩家并追击。玩家与球重叠或进入球的死亡触发区域时回出生地。

### runtime_third_mechanism.ts / runtime_third_mechanism_config.ts

第 3 关定时消失平台。

- `runtime_third_mechanism_config.ts`：定义第 3 关哪些平台参与机关、分组、编号、起始偏移、警告/隐藏时间。
- `runtime_third_mechanism.ts`：注册这些平台，按周期把平台设为正常、警告、隐藏，并在隐藏时开启死亡判定。

### runtime_compressor.ts

第 4 关压板机关。

带 `QRRole="fourth_compressor"` 的场景单位会注册成压板。运行时让压板周期性下降、停留、上升，并用死亡触发器处理被压中的玩家。

### fifth_middle_layer.ts

第 5 关夹层机关。

它绑定或创建 `夹层A` 到 `夹层E`，让红色危险夹层上下移动。触碰夹层触发器会回出生地。

### runtime_eighth_mechanism.ts

第 8 关移动横杆/长板机关。

它根据 `QRRole="eighth_moving_part"` 的场景单位绑定移动部件。移动距离方向由 `QRMoveZ` 指定，位置和尺寸从编辑器单位读取。

### runtime_ninth_mechanism.ts

第 9 关消失平台。

带 `QRRole="ninth_vanishing_platform"` 的平台被玩家触碰后会描边提示并渐隐，最终隐藏。玩家死亡回出生时，平台恢复可见。

### runtime_tenth_current.ts

第 10 关电流机关。

它根据 `QRRole="tenth_current"` 的场景单位绑定电流。`QRMoving=true` 的电流块会沿 X 轴移动，触碰电流死亡触发器后回出生地。

## tools 目录

`tools` 是开发/维护用脚本，不会在游戏运行时被加载。

### tools/cad

CAD 维护脚本目录。

当前没有 active 的 CAD 修改脚本。第 3 关 `84C` 的一次性修改脚本已删除，因为它硬编码了单个 CAD handle、局部坐标和投影线 handle，不适合作为通用工具维护。CAD 输入/输出文件仍记录在 `.tools/cad/`，流程说明见 `docs/cad_workflow.md`。

### tools/zlj_data/generate_level_terrain.py

结构化地形数据生成脚本。

当前用于把 `data/zlj/levels/level_XX.json` 生成回 `ts_src/zlj/levels/level_XX/terrain.ts`。

常用命令：

```bash
npm run generate:terrain
```

### tools/zlj_editor_scene/create_editor_scene.py

编辑器场景创建脚本，也是 `tools` 中最核心的脚本。

用途：

- 读取 `data/zlj/levels/level_XX.json`，生成出生地和第 1-10 关的静态场景计划。
- 根据 `data/zlj/fall_death_zones.json` 生成每关掉坑死亡触发器组件。
- 根据 `data/zlj/runtime_scene_bindings.json` 给需要运行时处理的组件写入 `QRRole` 等自定义 KV。
- 创建或更新对象树：
  - `QR_地图_ROOT`
  - `QR_出生地_ROOT`
  - `QR_第01关_ROOT` 到 `QR_第10关_ROOT`
  - 每关地板、墙、天花板、基础夹层、地形块和部分机关占位组件
- 给第 5 关额外创建 `夹层A` 到 `夹层E`。
- 对第 3 关运行时平台设置隐藏/无碰撞占位，交给运行时机制控制。
- 移动编辑器内置出生点到出生地砖上。
- 输出 `tools/zlj_editor_scene/latest_plan.json` 作为本次场景计划快照。

常用模式：

- `--dry-run`：只生成计划文件，不调用编辑器。
- `--batch-size`：分批创建对象，避免一次操作过多。
- `--start-index` / `--limit`：从计划中的某个位置开始，只跑一部分。

### tools/zlj_editor_scene/latest_plan.json

由 `create_editor_scene.py` 生成的场景计划快照。

它记录每个计划创建/更新的对象：

- 所属 section 和 module。
- 对象名、完整名、父节点名。
- 预制体 ID、模型 ID。
- 位置和尺寸。
- 颜色、是否运行时占位等。

这个文件主要用于排查“脚本准备创建什么”。通常不要手动改它，应修改 `data/zlj/levels/*.json`、`data/zlj/fall_death_zones.json`、场景单位 KV 或创建脚本后重新生成。

### tools/zlj_editor_scene/export_level_component_index.py

导出关卡组件索引文档。

用途：

- 调用 `create_editor_scene.py` 的 `build_plan()` 生成理论组件列表。
- 到编辑器中查询这些组件的 unit_id。
- 把 SVG 编号、分组、代码数据名、编辑器组件名、unit_id、位置、尺寸写入 Markdown。

当前默认导出第 3 关，输出到 `docs/level_03_component_index.md`。它用于把 SVG 标注、代码数据、编辑器实例和 CAD handle 对齐。

### tools/zlj_editor_scene/verify_editor_scene.py

编辑器场景对象树校验脚本。

用途：

- 根据 `create_editor_scene.py` 的计划生成期望对象列表。
- 查询编辑器中的实际对象。
- 校验对象是否存在，以及父子关系是否符合 `QR_地图_ROOT -> 各模块 ROOT -> 组件` 的结构。
- 输出 JSON 结果，包含 expected、found、missing、parent_mismatch 等统计。

### tools/zlj_editor_scene/__pycache__

Python 运行脚本后生成的字节码缓存目录。

它不是项目逻辑，也不需要手动维护；如果清理掉，Python 下次运行脚本会自动重新生成。

## 修改关卡几何数据时要同步注意

修改某关 `data/zlj/levels/level_XX.json` 后，通常需要考虑这些联动：

- 掉坑死亡区不会自动改变；需要单独修改 `data/zlj/fall_death_zones.json` 并重新生成场景计划。
- 运行 `npm run generate:terrain`，更新对应的 `terrain.ts` 生成物。
- 编辑器创建计划会改变，需要用 `create_editor_scene.py --dry-run` 或实际创建脚本重新生成/同步。
- 如果新增、删除或重命名第 2/3/4/8/9/10 关的机关组件，要给场景单位维护对应 `QRRole` 自定义 KV；迁移期也可以先同步修改 `data/zlj/runtime_scene_bindings.json`，再由创建脚本写入场景。
- 如果已有 SVG/CAD/组件索引文档，应该同步更新编号索引和图中标注。
