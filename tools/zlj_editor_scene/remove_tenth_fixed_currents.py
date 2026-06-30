#!/usr/bin/env python3
"""Remove unused level 10 fixed current groups and trigger spaces."""

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

from create_editor_scene import MARKER, lua_string  # noqa: E402


REMOVE_MARKER = f"{MARKER}_REMOVE_TENTH_FIXED_CURRENT"


def removal_names() -> list[str]:
    names = [
        "QR_第10关_固定电流_97F通用触发区域1",
        "QR_第10关_固定电流_983通用触发区域",
    ]
    names.extend(f"QR_第10关_dxf_97F_1_3301506_{index}" for index in range(1, 21))
    names.extend(f"QR_第10关_dxf_983_1_3301506_{index}" for index in range(1, 21))
    names.extend([
        "QR_第10关_固定电流_97F",
        "QR_第10关_固定电流_983",
    ])
    return names


def build_lua(run_id: str, names: list[str]) -> str:
    body = ",\n".join(lua_string(name) for name in names)
    return f"""
local RUN_ID = {lua_string(run_id)}
local MARKER = {lua_string(REMOVE_MARKER)}
local NAMES = {{
{body}
}}

local function emit(msg)
  EditorAPI.log(MARKER .. ":" .. RUN_ID .. ":" .. msg)
end

local function query_uid(name)
  local ok, result = pcall(function() return EditorAPI.query_unit_ids(name, false) end)
  if ok and result ~= nil and #result > 0 then
    local item = result[1]
    if type(item) == "table" then
      return item.id or item.uid or item.unit_id or item[1]
    end
    return item
  end
  return nil
end

local removed = 0
local missing = 0
local failed = 0

for index = 1, #NAMES do
  local name = NAMES[index]
  local uid = query_uid(name)
  if uid == nil then
    missing = missing + 1
  else
    local ok, err = pcall(function() return EditorAPI.destroy_obstacle(uid) end)
    if ok then
      removed = removed + 1
      emit("REMOVED:" .. name)
    else
      failed = failed + 1
      emit("FAILED:" .. name .. ":" .. tostring(err))
    end
  end
end

emit("DONE:total=" .. tostring(#NAMES) .. ":removed=" .. tostring(removed) .. ":missing=" .. tostring(missing) .. ":failed=" .. tostring(failed))
"""


def parse_result(log_text: str, run_id: str) -> dict[str, Any]:
    prefix = f"{REMOVE_MARKER}:{run_id}:"
    result: dict[str, Any] = {"total": 0, "removed": 0, "missing": 0, "failed": 0, "errors": []}
    for line in log_text.splitlines():
        if prefix not in line:
            continue
        payload = line.split(prefix, 1)[1].strip().strip('"')
        if payload.startswith("DONE:"):
            for key, value in re.findall(r"([a-z_]+)=(\d+)", payload):
                if key in result:
                    result[key] = int(value)
        elif payload.startswith("FAILED:"):
            result["errors"].append(payload)
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Remove unused level 10 fixed current units.")
    add_workspace_argument(parser)
    add_editor_transport_arguments(parser)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = args.workspace.resolve()
    names = removal_names()
    if args.dry_run:
        dump_json({"ok": True, "dry_run": True, "count": len(names), "names": names}, compact=False)
        return 0

    run_id = str(int(time.time()))
    try:
        log_text = run_editor_lua_and_collect_logs(
            workspace,
            build_lua(run_id, names),
            mode=args.mode,
            backend_ws_url=args.backend_ws_url,
            timeout=args.timeout,
            progress=lambda msg: print(msg, file=sys.stderr),
            marker_prefixes=[REMOVE_MARKER],
        )
    except Exception as exc:
        dump_json(error_payload(str(exc), tool="remove_tenth_fixed_currents"), compact=False)
        return 1

    result = parse_result(log_text, run_id)
    ok = result["total"] == len(names) and result["failed"] == 0
    dump_json({"ok": ok, "summary": result}, compact=False)
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
