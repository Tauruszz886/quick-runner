# CAD Tools

This directory contains source scripts for CAD maintenance. Generated DWG/DXF files and local tool installs belong under `.tools/`.

## update_level03_84c.py

Updates the 第03关 component chain:

- SVG label: `11`
- CAD handle: `84C`
- terrain piece: `dxf_84C_24x17_1875`
- editor component: `QR_第03关_dxf_84C_24x17_1875`

The script reads a DXF, scales the `84C` ACIS body from local `x=92..116` to `x=94..114`, updates related projection lines, and writes a modified DXF.

Example:

```bash
.tools/venvs/pycad/bin/python tools/cad/update_level03_84c.py \
  .tools/cad/converted/第三关.dxf \
  .tools/cad/output/第三关_84C_20x17_1875.dxf
```

The surrounding DWG/DXF conversion and verification workflow is documented in `.tools/cad/README.md`.
