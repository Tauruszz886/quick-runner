# quick-runner 耦合点与整理计划

本文档记录当前项目里容易漂移、容易误改的耦合点，以及后续建议的整理顺序。

## 当前状态

项目里有三类内容：

- `ts_src/`：游戏运行时 TypeScript 源码，会参与构建和运行。
- `tools/`：可维护的开发辅助脚本，例如编辑器场景创建、校验、组件索引导出。
- `.tools/`：本地工作区，放 CAD 输入输出、转换结果、校验文件、临时实验文件、下载工具和虚拟环境等。这里的文件不是运行时代码。

此前最明显的问题是：`tools/zlj_editor_scene` 里的 Python 脚本会读取 `ts_src/zlj/levels/**/terrain.ts`，再生成编辑器场景计划和 JSON 快照。这条链路可用，但属于跨语言、跨目录的数据耦合。

当前第一阶段已经推进到：第 1-10 关地形源数据都迁移到 `data/zlj/levels/level_XX.json`，并由 `tools/zlj_data/generate_level_terrain.py` 生成 `ts_src/zlj/levels/level_XX/terrain.ts`。`create_editor_scene.py` 只读取 JSON，已移除旧的 `terrain.ts` 正则解析 fallback。

掉坑死亡区已从“运行时根据 terrain 推导空洞”改成显式数据和显式场景组件：源数据是 `data/zlj/fall_death_zones.json`，编辑器计划会创建带 `QRRole="fall_death"` 的 `QR_第XX关_掉坑死亡_fall_death_XX` 触发器组件。运行时不再生成或加载 `fall_death_zones.ts`。

运行时机关绑定已从“遍历 terrain 几何表/外部组件名单”改成场景自描述绑定：`create_editor_scene.py` 会把 `data/zlj/runtime_scene_bindings.json` 中的迁移数据写入场景单位自定义 KV，运行时从 `QR_地图_ROOT` 递归扫描带 `QRRole` 的单位，并从单位自身读取位置、尺寸和少量参数。`runtime_scene_bindings.ts`、`LEVEL_TERRAIN_SPECS` 汇总入口和 `fall_death_zones.ts` 均已删除；`terrain.ts` 不再是主运行路径的机关绑定来源。`runtime_terrain.ts` 中按 `LEVEL_TERRAIN_SPECS` 运行时创建地图的 `createRuntimeTiles()` 备用路径也已移除。

## 主要耦合点

### 1. 关卡几何数据的生成链路

位置：

- `data/zlj/levels/level_XX.json`
- `tools/zlj_data/generate_level_terrain.py`
- `ts_src/zlj/levels/level_XX/terrain.ts`
- `tools/zlj_editor_scene/create_editor_scene.py`

`data/zlj/levels/level_XX.json` 是关卡几何源数据。`generate_level_terrain.py` 会把它生成到 `terrain.ts`，`create_editor_scene.py` 直接读取 JSON 生成编辑器场景计划。

风险：

- 修改 JSON 后如果没有运行生成脚本，`terrain.ts` 生成物会漂移。
- 目前只有脚本内的字段检查，还没有独立 JSON schema。
- 第 10 关原本的 TS 表达式已经展开到 JSON；后续如果要恢复“公式化生成”，应该在数据生成工具里做，而不是让编辑器脚本和 TS 各算一遍。

当前状态：Python 正则解析 TypeScript 数据的问题已经移除。运行时机关绑定也已经不从 terrain 几何数据派生。

### 2. Python 和 TypeScript 重复维护布局常量

位置：

- `tools/zlj_editor_scene/create_editor_scene.py`
- `ts_src/zlj/config.ts`
- `ts_src/zlj/layout.ts`
- `ts_src/zlj/levels/shared/frames.ts`
- `ts_src/zlj/runtime/runtime_structure.ts`

重复内容包括：

- 出生地中心 X、运行时 Z。
- 地板、墙、天花板尺寸。
- 墙厚、墙内缩、西墙开口宽度。
- 普通地形高度、基础 Y。
- 第 4 关压板、第 5 关夹层、第 8 关机关的部分高度规则。

风险：

- 改 `config.ts` 后忘记改 Python，编辑器场景和运行时坐标不一致。
- 改 Python 后忘记改 TS，生成出来的场景看似正确，但运行时绑定/触发器位置不一致。

### 3. `latest_plan.json` 是生成物但被版本管理

位置：

- `tools/zlj_editor_scene/latest_plan.json`
- `tools/zlj_editor_scene/create_editor_scene.py`

`latest_plan.json` 是 `create_editor_scene.py` 根据当前 `data/zlj` 源数据生成的场景计划快照。

风险：

- 修改 `data/zlj` 源数据后如果没有重新生成，它会和源数据漂移。
- 其他人看 JSON 可能以为它是源数据，手动改了以后又会被下一次生成覆盖。

处理方向：

- 如果它只是调试快照，应移出 git 或放入 `.tools/`。
- 如果它要作为可审查产物保留，应增加明确的重新生成命令和漂移检查。

### 4. `create_editor_scene.py` 职责过多

位置：

- `tools/zlj_editor_scene/create_editor_scene.py`
- `tools/zlj_editor_scene/export_level_component_index.py`
- `tools/zlj_editor_scene/verify_editor_scene.py`

现在 `create_editor_scene.py` 同时负责：

- 解析 terrain 数据。
- 计算布局。
- 生成场景计划。
- 生成 Lua。
- 调用编辑器。
- 写 `latest_plan.json`。

另外两个脚本通过 import `build_plan()` 复用它：

- `export_level_component_index.py` 用它导出组件索引。
- `verify_editor_scene.py` 用它生成理论对象树。

风险：

- 想单独改“计划生成”时容易影响“编辑器执行”。
- 任何脚本复用 `build_plan()`，都会间接复用当前场景计划生成逻辑；这要求计划生成逻辑保持小而稳定。

### 5. 第 3 关编号链路人工维护

位置：

- `ts_src/zlj/levels/level_03/terrain.ts`
- `ts_src/zlj/runtime/runtime_third_mechanism_config.ts`
- `tools/zlj_editor_scene/export_level_component_index.py`
- `docs/level_03_component_index.md`
- `docs/level_03_layout.svg`
- CAD/DXF handle 记录

第 3 关平台需要同时对应：

- CAD handle。
- terrain 数据名。
- 编辑器组件名。
- SVG 编号。
- 运行时分组、起始偏移。
- 编辑器 unit_id。

风险：

- 改名字、尺寸或分组时，需要人工同步多处。
- 文档、SVG、运行时配置和编辑器实例可能不一致。

### 6. `.tools/cad` 同时包含源文件、产物和实验文件

位置：

- `.tools/cad/input/`
- `.tools/cad/converted/`
- `.tools/cad/output/`
- `.tools/cad/verify/`
- `.tools/cad/scratch/`

`.tools/cad` 是本地 CAD 工作区，不是游戏运行时目录，也不是可维护脚本目录。

当前含义：

- `input/`：收到的原始 CAD 文件，例如 `第三关.dwg`。
- `converted/`：直接转换结果，通常是 DWG 转 DXF，便于查看或被脚本处理。
- `output/`：正式修改后的 CAD 输出，可用于检查或交付。
- `verify/`：校验用文件，例如把最终 DWG 再转回 DXF 后确认尺寸。
- `scratch/`：一次性实验和中间测试文件。

风险：

- `converted/`、`verify/`、`scratch/` 很容易被误认为正式资产。
- 如果都进 git，仓库会越来越大。
- CAD 文件和代码数据之间没有自动校验链。

## 建议整理路线

### 第一阶段：明确源数据归属

目标：把运行时玩法语义从关卡几何硬编码里剥离。

状态：已完成主要切换。第 1-10 关地形已迁移到 JSON；掉坑死亡区和运行时机关绑定已经独立成显式场景组件/KV；编辑器创建脚本不再解析 `terrain.ts`。

建议做法：

- 运行时玩法绑定以场景单位自定义 KV 为准，不要再从 terrain 尺寸或坐标识别机关。
- `data/zlj/runtime_scene_bindings.json` 暂时只作为批量写 KV 的迁移输入；等场景 KV 稳定后继续降级或删除。
- 掉坑死亡区继续维护在 `data/zlj/fall_death_zones.json`，不要再从 terrain 覆盖区域推导。
- `terrain.ts` 只作为生成物保留，后续不要手写维护。
- 后续如果新增公式化地形生成，应放进 `tools/zlj_data/` 或显式数据生成步骤，不要放进编辑器创建脚本。

收益：

- TypeScript 和 Python 都从同一份数据派生。
- 后续可以对 JSON 做 schema 校验。
- 修改地形时更清楚：改数据，不改生成物。

### 第二阶段：抽出共享布局配置

目标：减少 Python 和 TS 里重复维护的常量。

建议做法：

- 把关卡 frame、出生点、墙参数、基础高度等放进共享 JSON。
- TS 从生成文件 import。
- Python 从同一份 JSON 读取。
- 保留 TS 里的运行时逻辑，但不要重复写布局常量。

收益：

- 改关卡尺寸、墙厚、出生点时只改一处。
- 编辑器场景和运行时更容易保持一致。

### 第三阶段：拆分编辑器工具

目标：降低 `create_editor_scene.py` 的职责。

建议拆成：

- `scene_plan.py`：读取数据并生成 `SceneItem` 列表。
- `scene_lua.py`：把计划转成 Lua。
- `create_editor_scene.py`：命令行入口，只负责调用编辑器执行。
- `verify_editor_scene.py` 和 `export_level_component_index.py` 只依赖 `scene_plan.py`。

收益：

- 计划生成可以单独测试。
- 校验、导出、创建脚本共享同一套轻量逻辑。
- 后续改数据来源时影响范围更小。

### 第四阶段：处理生成物和本地工作区

目标：区分源码、可审查产物、本地临时文件。

建议规则：

- `tools/` 只放可维护脚本。
- `.tools/` 放本地工作文件、下载工具、虚拟环境、中间产物。
- `latest_plan.json` 如果只是调试快照，移到 `.tools/zlj_editor_scene/` 并从 git 移除。
- `.tools/cad/output/` 可以保留必要成品；`converted/`、`verify/`、`scratch/` 默认不长期跟踪，除非某个文件确实需要作为证据留存。

### 第五阶段：给关键链路加检查

目标：让漂移尽早暴露。

建议检查：

- JSON schema 校验地形字段。
- 生成 TS 后检查 git diff，避免忘记提交生成物。
- 生成 editor plan 后和已提交快照比对。
- 第 3 关组件索引从数据生成，减少手写 `THIRD_LEVEL_LABELS`。

## 暂不建议马上做的事

- 不建议继续为单个 CAD handle 写长期脚本，除非确定同类修改会重复出现。
- 不建议让 Python 直接 import/执行 TS，工具链会更复杂。
- 不建议让运行时代码反过来读取 `tools/` 或 `.tools/`，这两个目录应保持开发侧属性。

## 推荐下一步

下一次整理可以从“共享配置和工具拆分”开始：

1. 把 Python 和 TS 重复维护的布局常量迁移到共享 JSON。
2. 让 `tools/zlj_data/generate_level_terrain.py` 同时校验 `data/zlj/levels/*.json`、掉坑区、运行时绑定。
3. 拆分 `create_editor_scene.py`：把计划生成、Lua 渲染、编辑器执行拆成独立模块。
4. 决定 `tools/zlj_editor_scene/latest_plan.json` 是否继续进 git；如果只是快照，迁到 `.tools/`。
5. 继续把第 3 关组件索引、SVG 标注和运行时配置之间的人工编号链路收口。
