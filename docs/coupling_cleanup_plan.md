# quick-runner 耦合点与整理计划

本文档只记录当前仍需要处理的耦合点。已经完成的迁移和已删除的旧路径不在这里继续展开。

## 当前原则

- 运行时玩法绑定以编辑器场景单位自定义 KV 为准，例如 `QRRole`、`QRModule`、`QRComponent`、`QRMoveZ`、`QRMoving`。
- `data/zlj/levels/*.json` 仍是编辑器重建地形的几何输入。
- `tools/` 放可维护脚本；`.tools/` 放本地工作区和中间产物。

## 仍存在的耦合点

### 1. 运行时绑定迁移输入仍存在

位置：

- `data/zlj/runtime_scene_bindings.json`
- `tools/zlj_editor_scene/create_editor_scene.py`
- 编辑器场景单位自定义 KV

问题：

- 运行时已经不读取 `runtime_scene_bindings.json`。
- 这份 JSON 现在只用于让创建脚本批量写 `QRRole` 等 KV。
- 等编辑器场景里的 KV 成为稳定事实源后，这份 JSON 会变成重复来源。

处理方向：

- 实际跑一次创建脚本，把 KV 写入编辑器场景。
- 用场景快照确认目标单位都带有正确 `QRRole`。
- 确认后删除或封存 `data/zlj/runtime_scene_bindings.json`，让后续维护直接改场景 KV。

### 2. Python 和 TypeScript 重复维护布局常量

位置：

- `tools/zlj_editor_scene/create_editor_scene.py`
- `ts_src/zlj/config.ts`
- `ts_src/zlj/layout.ts`
- `ts_src/zlj/levels/shared/frames.ts`
- `ts_src/zlj/runtime/runtime_structure.ts`

重复内容：

- 出生地中心 X、运行时 Z。
- 地板、墙、天花板尺寸。
- 墙厚、墙内缩、西墙开口宽度。
- 普通地形高度、基础 Y。
- 第 4 关压板、第 5 关夹层、第 8 关机关的部分高度规则。

处理方向：

- 抽出共享布局配置，例如 `data/zlj/layout.json`。
- Python 直接读取 JSON。
- TS 由生成文件或轻量 loader 使用同一份数据。

### 3. create_editor_scene.py 职责过多

位置：

- `tools/zlj_editor_scene/create_editor_scene.py`
- `tools/zlj_editor_scene/export_level_component_index.py`
- `tools/zlj_editor_scene/verify_editor_scene.py`

问题：

- 一个文件同时负责读取数据、计算布局、生成计划、渲染 Lua、调用编辑器、写快照。
- 其他脚本 import `build_plan()`，会被迫依赖整套创建脚本。

处理方向：

- 拆出 `scene_plan.py`：读取数据并生成 `SceneItem`。
- 拆出 `scene_lua.py`：把计划渲染为 Lua。
- `create_editor_scene.py` 只保留命令行入口和编辑器调用。
- `verify_editor_scene.py`、`export_level_component_index.py` 只依赖 `scene_plan.py`。

### 4. 快照文件被版本管理

位置：

- `tools/zlj_editor_scene/latest_plan.json`
- `scenes/latest_scene_units.json`
- `scenes/latest_scene_units.tree.md`

问题：

- 这些文件都是当前状态快照，不是源数据。
- 放在 git 里会产生大量 diff，也容易被误认为可手改配置。

处理方向：

- 如果只是排查用，移到 `.tools/` 并加入 `.gitignore`。
- 如果要保留可审查快照，需要明确再生成命令和漂移检查规则。

### 5. 第 3 关编号链路仍需收口

位置：

- `data/zlj/levels/level_03.json`
- `ts_src/zlj/runtime/runtime_third_mechanism_config.ts`
- `tools/zlj_editor_scene/export_level_component_index.py`
- `docs/level_03_component_index.md`
- `docs/level_03_layout.svg`
- CAD/DXF handle 记录

问题：

- 第 3 关平台仍需要同时对应 CAD handle、数据名、编辑器组件名、SVG 编号、运行时分组和 unit_id。
- 改名字、尺寸或分组时，仍可能需要人工同步多处。

处理方向：

- 把第 3 关平台的编号、分组、运行时参数集中到一份结构化数据。
- 组件索引和 SVG 标注尽量从同一份数据生成。

### 6. CAD 工作区边界

位置：

- `.tools/cad/input/`
- `.tools/cad/converted/`
- `.tools/cad/output/`
- `.tools/cad/verify/`
- `.tools/cad/scratch/`

问题：

- `.tools/cad` 是本地 CAD 工作区，不是运行时代码，也不是可维护脚本目录。
- `converted/`、`verify/`、`scratch/` 很容易被误认为正式资产。

处理方向：

- `input/` 放收到的原始 CAD。
- `output/` 放需要交付或长期保留的结果。
- `converted/`、`verify/`、`scratch/` 默认不进 git，除非明确需要作为证据留存。

## 可删除或降级清单

- `data/zlj/runtime_scene_bindings.json`：等场景 KV 写入并验证后删除或封存。
- `tools/zlj_editor_scene/latest_plan.json`：作为调试快照迁到 `.tools/`。
- `scenes/latest_scene_units.json` / `scenes/latest_scene_units.tree.md`：作为场景快照迁到 `.tools/` 或忽略。
- `runtime_structure.ts` 中运行时生成地板/墙/天花板的旧入口：确认没有调用后可继续封存或删除。

## 推荐下一步

1. 实际运行 `create_editor_scene.py`，把 `QRRole` 等 KV 写入编辑器场景。
2. 重新导出场景快照，确认所有玩法组件都有正确 KV。
3. 删除或封存 `data/zlj/runtime_scene_bindings.json`。
4. 把快照文件迁出 git。
5. 拆分 `create_editor_scene.py`。
6. 抽出共享布局配置。
