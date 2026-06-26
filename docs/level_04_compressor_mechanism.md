# 第04关压板机关

第 04 关压板现在采用“编辑器触发区子组件 + 运行时绑定”的方式，不再由运行时动态创建死亡触发区。

## 场景结构

每块压板有一个 3101010 触发区域子组件，触发区本地位置为 `(0, 4, 0)`，也就是从压板中心点向上偏移 4，跟随父压板上下移动。

当前两块压板：

- `QR_第04关_dxf_736_56x25`
  - 子触发区：`QR_第04关_dxf_736_56x25_压板死亡触发区`
  - 触发区尺寸：`56.5 x 8.5 x 25.5`
- `QR_第04关_dxf_731_48x25`
  - 子触发区：`QR_第04关_dxf_731_48x25_压板死亡触发区`
  - 触发区尺寸：`48.5 x 8.5 x 25.5`

触发区尺寸按压板尺寸外扩 `0.25` 生成。

## 自定义 KV

压板本体：

```json
{
  "QRRole": "fourth_compressor",
  "QRModule": 4,
  "QRComponent": "dxf_736_56x25",
  "QRRuntimeName": "第04关_dxf_736_56x25",
  "QRMoving": true,
  "QRTouchDeath": true,
  "QRMoveSeconds": 1.5
}
```

死亡触发区：

```json
{
  "QRRole": "fourth_compressor_death_trigger",
  "QRModule": 4,
  "QRComponent": "dxf_736_56x25_压板死亡触发区",
  "QRRuntimeName": "第04关_dxf_736_56x25_压板死亡触发区",
  "QRTargetComponent": "dxf_736_56x25",
  "QRTargetRuntimeName": "第04关_dxf_736_56x25",
  "QRMoving": true,
  "QRTouchDeath": true,
  "QRMoveSeconds": 1.5
}
```

`QRTargetRuntimeName` 只需要写在触发区上，用来绑定对应压板。

## 运行时绑定

- `runtime_scene_scan.ts` 扫描 `fourth_compressor` 和 `fourth_compressor_death_trigger`。
- `runtime_terrain.ts` 把压板注册到 `registerRuntimeCompressorPiece()`，把死亡触发区注册到 `registerRuntimeCompressorDeathTriggerUnit()`。
- `runtime_compressor.ts` 只移动压板本体；死亡触发区作为子组件跟随父压板移动。
- 玩家进入死亡触发区时调用 `eliminateUnitAndRebirthAtBirth()`。

## 帧段运动参数

压板运行时按帧分段移动。计算口径是压板组件底面 `Y=0` 对齐地砖组件顶面 `Y=3`，地砖顶面世界坐标为 `Y=6.5`，压板运行时起点校准为 `Y=14.5`，总下降距离为 `8`。

- 下压：`20` 帧，分 3 段下降。
- 停留：到达下压端点后停留 `2s`。
- 回升：`20` 帧，分 3 段回升。
- 下压端点：`Y=6.5`，对应第四关地砖顶面。
- 循环边界会调用一次 `set_position` 校准端点，避免逐帧累计误差。

`QRMoveSeconds` 保留在自定义 KV 中作为配置记录，当前运行时实际移动以帧数为准。
