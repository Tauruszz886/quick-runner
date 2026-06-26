# QRRole 机关组件性能优化关闭记录

日期：2026-06-26

## 背景

第三关渐隐地砖运行时扫描最初只能找到 1 块。用户确认能被找到的那块是手动关闭了“组件性能优化”的组件，因此需要把带自定义 KV、会被运行时机关绑定的组件统一关闭该优化。

本项目中，运行时机关绑定以 `custom_kv.QRRole` 为入口，来源计划文件为：

- `tools/zlj_editor_scene/latest_plan.json`

编辑器实例里的“组件性能优化”对应可读写属性：

- `MotorOpti`

## 处理范围

按 `latest_plan.json` 中带 `custom_kv.QRRole` 的项处理，共 287 个计划机关单位。

按角色统计：

- `second_chaser_surface`: 3
- `third_vanishing_platform`: 12
- `third_vanishing_trigger`: 12
- `fourth_compressor`: 2
- `eighth_moving_part`: 44
- `ninth_vanishing_platform`: 2
- `tenth_current`: 100
- `fall_death`: 112

## 执行方式

通过 backend local-agent 执行 EditorAPI Lua：

1. 先停止试玩：`EditorAPI.stop_game()`。
2. 遍历 `EditorAPI.get_all_unit_ids()`。
3. 对每个单位读取 `name`，用 `full_name` / `legacy_full_name` 做完全相等匹配。
4. 对匹配单位读取 `EditorAPI.get_unit_attr(uid, "MotorOpti")`。
5. 能读到 `MotorOpti` 的单位执行 `EditorAPI.set_unit_attr(uid, "MotorOpti", false)`。
6. 立即回读 `MotorOpti`，确认值为 `false`。

注意：没有使用 `EditorAPI.query_unit_ids(name, false)` 作为最终匹配依据，因为该接口会把 `QR_第03关_xxx` 匹配到 `QR_第03关_xxx_渐隐触发区`，容易误判。

## 执行结果

精确匹配执行结果：

```text
total=287
found=287
missing=0
readable=63
changed=61
already_false=2
verify_ok=63
attr_missing=224
set_failed=0
verify_failed=0
third_platform_readable=12
third_platform_ok=12
```

含义：

- 287 个带 `QRRole` 的计划机关单位都在编辑器场景里找到了。
- 其中 63 个单位有 `MotorOpti` 属性，并且全部已回读确认 `false`。
- 224 个单位没有 `MotorOpti` 属性，主要是触发区、掉坑死亡触发器等逻辑触发组件。
- 第三关 12 块渐隐地砖本体全部有 `MotorOpti`，并且全部已回读确认 `false`。
- 没有单位设置失败，没有回读失败。

## 启动验证

关闭 `MotorOpti` 后重新 `sync-start` 启动游戏，当前运行时启动日志仍显示第三关 12 块地砖只扫描到 2 块：

```text
[ZLJ_RUNTIME_TERRAIN] third_level_tile_snapshot expected=12 role_scan=2 direct_query=2 role_scan_ok=false direct_query_ok=false
```

当前运行时能找到的两块：

- `第03关_dxf_868_24x17_1875`
- `第03关_dxf_850_24x17_1875`

当前运行时仍缺失的十块：

- `第03关_dxf_840_24x17_1875`
- `第03关_dxf_85C_24x17_1875`
- `第03关_dxf_860_24x17_1875`
- `第03关_dxf_864_24x17_1875`
- `第03关_dxf_844_24x17_1875`
- `第03关_dxf_858_24x17_1875`
- `第03关_dxf_86C_24x17_1875`
- `第03关_dxf_848_24x17_1875`
- `第03关_dxf_84C_24x17_1875`
- `第03关_dxf_854_24x17_1875`

## 当前判断

`MotorOpti=false` 已经在编辑态完成并回读确认，但运行时仍没有完整暴露 12 块地砖。后续需要继续排查：

- 编辑器是否还有另一个影响运行时 `LuaAPI.query_unit` / `get_children()` 暴露的优化开关。
- `MotorOpti` 写入是否还需要额外保存/重载场景后才影响试玩构建。
- 第三关 10 块仍缺失地砖是否存在特殊合批、实例化或层级差异。
