#!/usr/bin/env python3
"""Sync rebuilt level 06 scene items to the editor.

This script removes obsolete level 06 units from the old DXF layout, then
reuses create_editor_scene.py's plan generation and Lua writer to create/update
only module 6.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
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

from create_editor_scene import MARKER, build_lua, build_plan, parse_summary  # noqa: E402


SYNC_MARKER = "QR_LEVEL06_SYNC"
OBSOLETE_COMPONENTS = [
    "dxf_687_11_2x37_5",
    "dxf_683_8x17_5",
    "dxf_667_12x9_375",
    "dxf_663_12x10_625",
    "dxf_66F_12x11_25",
    "dxf_66B_20x17_5",
    "dxf_65B_32x17_5",
    "dxf_657_16x75",
    "掉坑死亡_fall_death_20",
]


def lua_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def obsolete_names() -> list[str]:
    names: list[str] = []
    for component in OBSOLETE_COMPONENTS:
        names.append(f"QR_第06关_{component}")
        names.append(f"QR_第6关_{component}")
    return names


def cleanup_lua(run_id: str) -> str:
    names = ",\n".join(lua_string(name) for name in obsolete_names())
    return f"""
local RUN_ID = {lua_string(run_id)}
local MARKER = {lua_string(SYNC_MARKER)}
local NAMES = {{
{names}
}}

local function emit(msg)
  EditorAPI.log(MARKER .. ":" .. RUN_ID .. ":" .. msg)
end

local function query_by_name(name)
  local ok, result = pcall(function()
    return EditorAPI.query_unit_ids(name, false)
  end)
  if ok and result ~= nil and #result > 0 then
    return result
  end
  return {{}}
end

local destroyed = 0
local missing = 0
local failed = 0
for index = 1, #NAMES do
  local name = NAMES[index]
  local ids = query_by_name(name)
  if #ids == 0 then
    missing = missing + 1
  end
  for id_index = 1, #ids do
    local item = ids[id_index]
    local uid = item
    if type(item) == "table" then
      uid = item.id or item.uid or item.unit_id or item[1]
    end
    local ok, err = pcall(function()
      return EditorAPI.destroy_obstacle(uid)
    end)
    if ok then
      destroyed = destroyed + 1
      emit("DESTROYED:" .. tostring(name) .. ":uid=" .. tostring(uid))
    else
      failed = failed + 1
      emit("DESTROY_FAIL:" .. tostring(name) .. ":uid=" .. tostring(uid) .. ":" .. tostring(err))
    end
  end
end
emit("DONE:destroyed=" .. tostring(destroyed) .. ":missing=" .. tostring(missing) .. ":failed=" .. tostring(failed))
"""


def level06_lua(items: list[Any], run_id: str) -> str:
    raw = build_lua(items, run_id)
    old = """      pcall(function() EditorAPI.set_unit_attr(uid, \"name\", item.name) end)
      pcall(function() EditorAPI.set_unit_attr(uid, \"position\", pos) end)
      pcall(function() EditorAPI.set_unit_attr(uid, \"scale\", math.Vector3(item.sx, item.sy, item.sz)) end)"""
    new = """      local ok_name, name_err = pcall(function() EditorAPI.set_unit_attr(uid, \"name\", item.name) end)
      local ok_read_name, actual_name = pcall(function() return EditorAPI.get_unit_attr(uid, \"name\") end)
      if not ok_name or not ok_read_name or tostring(actual_name) ~= tostring(item.name) then
        failed = failed + 1
        emit(\"FAIL_SET_NAME:\" .. tostring(index) .. \":\" .. tostring(uid) .. \":\" .. item.name .. \":actual=\" .. tostring(actual_name) .. \":err=\" .. tostring(name_err))
      else
        pcall(function() EditorAPI.set_unit_attr(uid, \"position\", pos) end)
        pcall(function() EditorAPI.set_unit_attr(uid, \"scale\", math.Vector3(item.sx, item.sy, item.sz)) end)"""
    raw = raw.replace(old, new, 1)
    old_tail = """      created = created + 1
      existing[item.name] = uid
    else"""
    new_tail = """      created = created + 1
        existing[item.name] = uid
      end
    else"""
    raw = raw.replace(old_tail, new_tail, 1)
    return raw


def parse_cleanup_summary(log_text: str, run_id: str) -> dict[str, int]:
    summary = {"destroyed": 0, "missing": 0, "failed": 0}
    prefix = f"{SYNC_MARKER}:{run_id}:DONE:"
    for line in log_text.splitlines():
      if prefix not in line:
          continue
      payload = line.split(prefix, 1)[1].strip().strip('"')
      for key, value in re.findall(r"(destroyed|missing|failed)=(\d+)", payload):
          summary[key] = int(value)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Clean obsolete units and sync rebuilt level 06 scene items.")
    add_workspace_argument(parser)
    add_editor_transport_arguments(parser)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = args.workspace.resolve()
    items = [item for item in build_plan(workspace) if item.module == 6]
    if args.dry_run:
        dump_json(
            {
                "ok": True,
                "dry_run": True,
                "obsolete_names": obsolete_names(),
                "level06_items": len(items),
                "level06_item_names": [item.name for item in items],
            },
            compact=False,
        )
        return 0

    cleanup_run_id = f"{int(time.time())}_cleanup"
    cleanup_log = run_editor_lua_and_collect_logs(
        workspace,
        cleanup_lua(cleanup_run_id),
        mode=args.mode,
        backend_ws_url=args.backend_ws_url,
        timeout=args.timeout,
        progress=lambda msg: print(msg, file=sys.stderr),
        marker_prefixes=[SYNC_MARKER],
    )
    cleanup_summary = parse_cleanup_summary(cleanup_log, cleanup_run_id)
    if cleanup_summary["failed"] != 0:
        dump_json({"ok": False, "stage": "cleanup", "summary": cleanup_summary}, compact=False)
        return 2

    sync_run_id = f"{int(time.time())}_sync"
    sync_log = run_editor_lua_and_collect_logs(
        workspace,
        level06_lua(items, sync_run_id),
        mode=args.mode,
        backend_ws_url=args.backend_ws_url,
        timeout=args.timeout,
        progress=lambda msg: print(msg, file=sys.stderr),
        marker_prefixes=[MARKER],
    )
    sync_summary = parse_summary(sync_log, sync_run_id)
    ok = sync_summary["total"] == len(items) and sync_summary["failed"] == 0
    dump_json(
        {
            "ok": ok,
            "cleanup": cleanup_summary,
            "sync": sync_summary,
            "level06_items": len(items),
        },
        compact=False,
    )
    return 0 if ok else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        dump_json(error_payload(exc), compact=False)
        raise SystemExit(2)
