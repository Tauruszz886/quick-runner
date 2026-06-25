#!/usr/bin/env python3
"""Verify the quick-runner Zulijian editor scene object tree."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

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

from create_editor_scene import MARKER, build_plan, lua_string, root_name  # noqa: E402


VERIFY_MARKER = f"{MARKER}_VERIFY"


def expected_entries(workspace: Path) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = [("QR_地图_ROOT", "")]
    entries.append(("QR_出生地_ROOT", "QR_地图_ROOT"))
    for module in range(1, 11):
        entries.append((root_name(module), "QR_地图_ROOT"))
    entries.extend((item.full_name, item.parent_name) for item in build_plan(workspace))
    return entries


def build_lua(entries: list[tuple[str, str]], run_id: str) -> str:
    expected = ",\n".join(
        f"{{name={lua_string(name)}, parent={lua_string(parent)}}}" for name, parent in entries
    )
    return f"""
local RUN_ID = {lua_string(run_id)}
local MARKER = {lua_string(VERIFY_MARKER)}
local EXPECTED = {{
{expected}
}}

local function emit(msg)
  EditorAPI.log(MARKER .. ":" .. RUN_ID .. ":" .. msg)
end

local by_name = {{}}
local by_id = {{}}
local ok_ids, ids = pcall(function() return EditorAPI.get_all_unit_ids() end)
if ok_ids and ids ~= nil then
  for i = 1, #ids do
    local uid = ids[i]
    local ok_name, name = pcall(function() return EditorAPI.get_unit_attr(uid, "name") end)
    if ok_name and name ~= nil then
      local text_name = tostring(name)
      by_name[text_name] = uid
      by_id[tostring(uid)] = text_name
    end
  end
end

local found = 0
local missing = 0
local parent_mismatch = 0
local missing_names = {{}}
local mismatch_names = {{}}

for i = 1, #EXPECTED do
  local item = EXPECTED[i]
  local uid = by_name[item.name]
  if uid == nil then
    missing = missing + 1
    if #missing_names < 30 then
      missing_names[#missing_names + 1] = item.name
    end
  else
    found = found + 1
    if item.parent ~= "" then
      local ok_parent, parent_id = pcall(function() return EditorAPI.get_unit_attr(uid, "parent_unit_id") end)
      local parent_name = ""
      if ok_parent and parent_id ~= nil then
        parent_name = by_id[tostring(parent_id)] or ""
      end
      if parent_name ~= item.parent then
        parent_mismatch = parent_mismatch + 1
        if #mismatch_names < 30 then
          mismatch_names[#mismatch_names + 1] = item.name .. "->" .. parent_name .. "(expected " .. item.parent .. ")"
        end
      end
    end
  end
end

emit(
  "RESULT:expected=" .. tostring(#EXPECTED)
  .. ":found=" .. tostring(found)
  .. ":missing=" .. tostring(missing)
  .. ":parent_mismatch=" .. tostring(parent_mismatch)
  .. ":missing_names=" .. table.concat(missing_names, "|")
  .. ":mismatch_names=" .. table.concat(mismatch_names, "|")
)
"""


def parse_result(log_text: str, run_id: str) -> dict[str, object]:
    prefix = f"{VERIFY_MARKER}:{run_id}:RESULT:"
    result: dict[str, object] = {
        "expected": 0,
        "found": 0,
        "missing": 0,
        "parent_mismatch": 0,
        "missing_names": [],
        "mismatch_names": [],
    }
    for line in log_text.splitlines():
        if prefix not in line:
            continue
        payload = line.split(prefix, 1)[1].strip().strip('"')
        for key in ("expected", "found", "missing", "parent_mismatch"):
            match = re.search(rf"{key}=(\d+)", payload)
            if match:
                result[key] = int(match.group(1))
        for key in ("missing_names", "mismatch_names"):
            match = re.search(rf"{key}=([^:]*)(?::|$)", payload)
            if match and match.group(1):
                result[key] = match.group(1).split("|")
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify quick-runner Zulijian editor scene object tree.")
    add_workspace_argument(parser)
    add_editor_transport_arguments(parser)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = args.workspace.resolve()
    entries = expected_entries(workspace)
    run_id = "verify"
    log_text = run_editor_lua_and_collect_logs(
        workspace,
        build_lua(entries, run_id),
        mode=args.mode,
        backend_ws_url=args.backend_ws_url,
        timeout=args.timeout,
        progress=lambda msg: print(msg, file=sys.stderr),
        marker_prefixes=[VERIFY_MARKER],
    )
    result = parse_result(log_text, run_id)
    ok = (
        result["expected"] == len(entries)
        and result["found"] == len(entries)
        and result["missing"] == 0
        and result["parent_mismatch"] == 0
    )
    dump_json({"ok": ok, "result": result}, compact=False)
    return 0 if ok else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        dump_json(error_payload(exc), compact=False)
        raise SystemExit(2)
