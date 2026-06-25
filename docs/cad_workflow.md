# CAD 工作流

本文档记录 quick-runner 当前 CAD/DWG/DXF 维护流程。脚本源码在 `tools/cad/`，本地输入输出和工具缓存放在 `.tools/`。

## 目录边界

- `tools/cad/`：可维护脚本源码。
- `.tools/cad/input/`：原始 CAD 输入文件。
- `.tools/cad/converted/`：由 ODA File Converter 转出的中间 DXF。
- `.tools/cad/output/`：正式修改结果。
- `.tools/cad/verify/`：用于验证正式结果的反转文件。
- `.tools/cad/scratch/`：实验性中间产物。

## 第 3 关 84C 修改链路

当前已知组件链路：

| 项 | 值 |
| --- | --- |
| SVG 编号 | `11` |
| CAD handle | `84C` |
| terrain piece | `dxf_84C_24x17_1875` |
| 编辑器组件 | `QR_第03关_dxf_84C_24x17_1875` |
| unit_id | `1032584478` |

处理流程：

```text
.tools/cad/input/第三关.dwg
  -> ODA File Converter
  -> .tools/cad/converted/第三关.dxf
  -> historical manual/scripted CAD edit
  -> .tools/cad/output/第三关_84C_20x17_1875.dxf
  -> ODA File Converter
  -> .tools/cad/output/第三关_84C_20x17_1875.dwg
  -> ODA File Converter
  -> .tools/cad/verify/第三关_84C_20x17_1875.dxf
```

第 3 关 `84C` 的当前结果是：局部 X 范围从 `92..116` 改为 `94..114`，也就是宽度从 `24` 改为 `20`，Z 尺寸保持 `17.1875`，中心保持不变。

## 脚本状态

当前仓库不再保留第 3 关 `84C` 的专项修改脚本。该脚本只服务一次历史修补，硬编码了 CAD handle、局部坐标和投影线 handle，不适合作为长期工具维护。后续如果还要自动修改 CAD，应重新设计通用脚本或把一次性脚本放到临时工作区。

## scratch 文件

`.tools/cad/scratch/` 里的文件是测试产物。

当前包含：

- `test_transform_84C.dxf`
- `test_scaled_body_84C.dxf`

它们可以辅助排查 ACIS body 缩放过程，但不是最终交付文件。最终结果以 `.tools/cad/output/` 为准。
