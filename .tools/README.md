# .tools

`.tools/` is the local working area for maintenance tools and generated artifacts. It is not game runtime code.

Use `tools/` for script source code. Use `.tools/` for large inputs, converted files, output files, installed utilities, and temporary experiments.

Current layout:

- `cad/`: DWG/DXF inputs, converted files, official outputs, verification files, and scratch experiments.
- `cache/downloads/`: downloaded installer files and download pages.
- `cache/oda/`: unpacked ODA File Converter files used for DWG/DXF conversion.
- `cache/xvfb/`: virtual display files used when running GUI-based conversion tools in a headless environment.
- `venvs/pycad/`: Python virtual environment for CAD scripts.

The `cache/` and `venvs/` directories are local tool dependencies. They are ignored by git and are not part of the game logic.
