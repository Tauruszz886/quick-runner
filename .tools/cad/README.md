# .tools/cad

This directory contains local CAD working files. The script source is in `tools/cad/`.

## Directory Layout

- `input/`: original CAD files received as source material.
- `converted/`: direct conversion outputs, usually DWG converted to DXF before Python processing.
- `output/`: official modified CAD outputs that are meant to be inspected or shared.
- `verify/`: files produced only to verify an output, such as a final DWG converted back to DXF.
- `scratch/`: one-off experiments and intermediate test files.

## Current 第03关 Flow

```text
input/第三关.dwg
  -> converted/第三关.dxf
  -> tools/cad/update_level03_84c.py
  -> output/第三关_84C_20x17_1875.dxf
  -> output/第三关_84C_20x17_1875.dwg
  -> verify/第三关_84C_20x17_1875.dxf
```

`scratch/test_transform_84C.dxf` and `scratch/test_scaled_body_84C.dxf` are experiment outputs from the `84C` resizing work. They are useful for investigation, but they are not the final CAD deliverable.

## Notes

Use ODA File Converter for DWG/DXF conversion. Use `.tools/venvs/pycad/bin/python` when running `tools/cad/update_level03_84c.py`.
