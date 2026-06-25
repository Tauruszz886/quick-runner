#!/usr/bin/env python3
"""Export level component index with SVG labels, data names, and editor unit IDs."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

WORKSPACE = Path(__file__).resolve().parents[2]
PLATFORM_ROOT = WORKSPACE.parent / "platform"
COMMON_ROOT = PLATFORM_ROOT / "skills" / "common"
if str(COMMON_ROOT) not in sys.path:
    sys.path.insert(0, str(COMMON_ROOT))

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from eggitor_agent.cli import add_editor_transport_arguments, add_workspace_argument, dump_json, error_payload  # noqa: E402
from eggitor_agent.runner import run_editor_lua_and_collect_logs  # noqa: E402

from create_editor_scene import MARKER, build_plan, lua_string  # noqa: E402


INDEX_MARKER = f"{MARKER}_INDEX"
THIRD_LEVEL_LABELS = {
    "dxf_864_24x17_1875": {"label": 5, "group": "G1", "start_offset_seconds": 0},
    "dxf_868_24x17_1875": {"label": 9, "group": "G1", "start_offset_seconds": 1.5},
    "dxf_854_24x17_1875": {"label": 13, "group": "G1", "start_offset_seconds": 3},
    "dxf_860_24x17_1875": {"label": 4, "group": "G2", "start_offset_seconds": 0.7},
    "dxf_86C_24x17_1875": {"label": 8, "group": "G2", "start_offset_seconds": 2.2},
    "dxf_850_24x17_1875": {"label": 12, "group": "G2", "start_offset_seconds": 3.7},
    "dxf_85C_24x17_1875": {"label": 3, "group": "G3", "start_offset_seconds": 1.4},
    "dxf_858_24x17_1875": {"label": 7, "group": "G3", "start_offset_seconds": 2.9},
    "dxf_84C_24x17_1875": {"label": 11, "group": "G3", "start_offset_seconds": 4.4},
    "dxf_840_24x17_1875": {"label": 2, "group": "G4", "start_offset_seconds": 2.1},
    "dxf_844_24x17_1875": {"label": 6, "group": "G4", "start_offset_seconds": 3.6},
    "dxf_848_24x17_1875": {"label": 10, "group": "G4", "start_offset_seconds": 5.1},
}


def piece_name(full_name: str, module: int) -> str:
    prefix = f"QR_第{module:02d}关_"
    return full_name[len(prefix) :] if full_name.startswith(prefix) else full_name


def level_entries(workspace: Path, module: int) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for item in build_plan(workspace):
        if item.module != module or not item.name.startswith(f"第{module:02d}关_dxf_"):
            continue
        piece = piece_name(item.full_name, module)
        label_info = THIRD_LEVEL_LABELS.get(piece, {})
        entries.append(
            {
                "svg_label": label_info.get("label", ""),
                "group": label_info.get("group", ""),
                "start_offset_seconds": label_info.get("start_offset_seconds", ""),
                "piece_name": piece,
                "component_name": item.full_name,
                "parent_name": item.parent_name,
                "x": item.x,
                "y": item.y,
                "z": item.z,
                "sx": item.sx,
                "sy": item.sy,
                "sz": item.sz,
            }
        )
    return sorted(entries, key=lambda entry: (entry["svg_label"] == "", entry["svg_label"] or 999, entry["piece_name"]))


def build_lua(component_names: list[str], run_id: str) -> str:
    names = ",\n".join(lua_string(name) for name in component_names)
    return f"""
local RUN_ID = {lua_string(run_id)}
local MARKER = {lua_string(INDEX_MARKER)}
local NAMES = {{
{names}
}}

local function emit(msg)
  EditorAPI.log(MARKER .. ":" .. RUN_ID .. ":" .. msg)
end

local by_name = {{}}
local ok_ids, ids = pcall(function() return EditorAPI.get_all_unit_ids() end)
if ok_ids and ids ~= nil then
  for i = 1, #ids do
    local uid = ids[i]
    local ok_name, name = pcall(function() return EditorAPI.get_unit_attr(uid, "name") end)
    if ok_name and name ~= nil then
      by_name[tostring(name)] = uid
    end
  end
end

for i = 1, #NAMES do
  local name = NAMES[i]
  local uid = by_name[name]
  emit("UNIT:name=" .. name .. ":uid=" .. tostring(uid or ""))
end
"""


def parse_units(log_text: str, run_id: str) -> dict[str, str]:
    prefix = f"{INDEX_MARKER}:{run_id}:UNIT:"
    out: dict[str, str] = {}
    for line in log_text.splitlines():
        if prefix not in line:
            continue
        payload = line.split(prefix, 1)[1].strip().strip('"')
        match = re.search(r"name=(.*):uid=([^:]*)$", payload)
        if match:
            out[match.group(1)] = match.group(2)
    return out


def write_markdown(path: Path, entries: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 第03关组件编号索引",
        "",
        "用于把 SVG 图里的编号、代码数据结构、编辑器组件名和编辑器 unit_id 对齐。",
        "",
        "| SVG编号 | 组 | pieceName | 编辑器组件名 | unit_id | 位置(x,y,z) | 尺寸(sx,sy,sz) |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for entry in entries:
        pos = f"{entry['x']},{entry['y']},{entry['z']}"
        scale = f"{entry['sx']},{entry['sy']},{entry['sz']}"
        lines.append(
            "| "
            + " | ".join(
                [
                    str(entry["svg_label"]),
                    str(entry["group"]),
                    f"`{entry['piece_name']}`",
                    f"`{entry['component_name']}`",
                    f"`{entry.get('unit_id', '')}`",
                    pos,
                    scale,
                ]
            )
            + " |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export level component index.")
    add_workspace_argument(parser)
    add_editor_transport_arguments(parser)
    parser.add_argument("--module", type=int, default=3)
    parser.add_argument("--out", default="docs/level_03_component_index.md")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = args.workspace.resolve()
    entries = level_entries(workspace, args.module)
    run_id = f"level_{args.module:02d}"
    log_text = run_editor_lua_and_collect_logs(
        workspace,
        build_lua([str(entry["component_name"]) for entry in entries], run_id),
        mode=args.mode,
        backend_ws_url=args.backend_ws_url,
        timeout=args.timeout,
        progress=lambda msg: print(msg, file=sys.stderr),
        marker_prefixes=[INDEX_MARKER],
    )
    units = parse_units(log_text, run_id)
    for entry in entries:
        entry["unit_id"] = units.get(str(entry["component_name"]), "")
    out_path = workspace / args.out
    write_markdown(out_path, entries)
    dump_json({"ok": True, "out": str(out_path), "entries": len(entries)}, compact=False)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        dump_json(error_payload(exc), compact=False)
        raise SystemExit(2)
