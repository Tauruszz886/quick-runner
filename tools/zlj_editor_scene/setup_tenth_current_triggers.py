#!/usr/bin/env python3
"""Bind level 10 editor current trigger spaces to their current groups."""

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

from create_editor_scene import MARKER, lua_custom_kv, lua_string  # noqa: E402


TRIGGER_MARKER = f"{MARKER}_TENTH_CURRENT_TRIGGERS"

TRIGGERS: list[dict[str, Any]] = [
    {
        "name": "QR_第10关_拖尾电流_97B_三道整体流触发区域",
        "parent": "QR_第10关_拖尾电流_97B_三道整体",
        "custom_kv": {
            "QRRole": "tenth_current_trigger",
            "QRModule": 10,
            "QRComponent": "拖尾电流_97B_三道整体流触发区域",
            "QRRuntimeName": "第10关_拖尾电流_97B_三道整体流触发区域",
            "QRTargetComponent": "拖尾电流_97B_三道整体",
            "QRTargetRuntimeName": "第10关_拖尾电流_97B_三道整体",
            "QRGroupId": "tenth_current_97B_all",
            "QRGroupKind": "moving_trail_current_group",
            "QRChildrenPattern": "dxf_97B_*_3301506_*",
            "QRChildCount": 60,
            "QRMoving": True,
            "QRTouchDeath": True,
        },
    },
    {
        "name": "QR_第10关_固定电流_983通用触发区域",
        "parent": "QR_第10关_固定电流_983",
        "custom_kv": {
            "QRRole": "tenth_current_trigger",
            "QRModule": 10,
            "QRComponent": "固定电流_983通用触发区域",
            "QRRuntimeName": "第10关_固定电流_983通用触发区域",
            "QRTargetComponent": "固定电流_983",
            "QRTargetRuntimeName": "第10关_固定电流_983",
            "QRGroupId": "tenth_current_983",
            "QRGroupKind": "fixed_current_group",
            "QRChildrenPattern": "dxf_983_1_3301506_*",
            "QRChildCount": 20,
            "QRMoving": False,
            "QRTrackIndex": 1,
            "QRGroupY": 6.5,
            "QRTouchDeath": True,
        },
    },
    {
        "name": "QR_第10关_固定电流_97F通用触发区域1",
        "parent": "QR_第10关_固定电流_97F",
        "custom_kv": {
            "QRRole": "tenth_current_trigger",
            "QRModule": 10,
            "QRComponent": "固定电流_97F通用触发区域1",
            "QRRuntimeName": "第10关_固定电流_97F通用触发区域1",
            "QRTargetComponent": "固定电流_97F",
            "QRTargetRuntimeName": "第10关_固定电流_97F",
            "QRGroupId": "tenth_current_97F",
            "QRGroupKind": "fixed_current_group",
            "QRChildrenPattern": "dxf_97F_1_3301506_*",
            "QRChildCount": 20,
            "QRMoving": False,
            "QRTrackIndex": 1,
            "QRGroupY": 6.5,
            "QRTouchDeath": True,
        },
    },
]


def lua_trigger_item(item: dict[str, Any]) -> str:
    return (
        "{"
        f"name={lua_string(str(item['name']))}, "
        f"parentName={lua_string(str(item['parent']))}, "
        f"customKv={lua_custom_kv(item['custom_kv'])}"
        "}"
    )


def build_lua(run_id: str) -> str:
    body = ",\n".join(lua_trigger_item(item) for item in TRIGGERS)
    return f"""
local RUN_ID = {lua_string(run_id)}
local MARKER = {lua_string(TRIGGER_MARKER)}
local ITEMS = {{
{body}
}}

local function emit(msg)
  EditorAPI.log(MARKER .. ":" .. RUN_ID .. ":" .. msg)
end

local function editor_kv_value_type(type_name)
  if Enums ~= nil and Enums.ValueType ~= nil and Enums.ValueType[type_name] ~= nil then
    return Enums.ValueType[type_name]
  end
  return type_name
end

local existing = {{}}
local by_id = {{}}
local ok_ids, ids = pcall(function() return EditorAPI.get_all_unit_ids() end)
if ok_ids and ids ~= nil then
  for i = 1, #ids do
    local uid = ids[i]
    local ok_name, name = pcall(function() return EditorAPI.get_unit_attr(uid, "name") end)
    if ok_name and name ~= nil then
      existing[tostring(name)] = uid
      by_id[tostring(uid)] = tostring(name)
    end
  end
end

local function add_child(parent_uid, child_uid)
  if parent_uid == nil or child_uid == nil or EditorAPI.unit_add_child == nil then
    return false
  end
  local ok, result = pcall(function()
    return EditorAPI.unit_add_child(parent_uid, child_uid)
  end)
  return ok and result ~= false
end

local function apply_custom_kv(uid, item)
  local ok_count = 0
  local fail_count = 0
  if uid == nil or item == nil or item.customKv == nil or EditorAPI.set_unit_kv == nil then
    return 0, 1
  end
  for index = 1, #item.customKv do
    local kv = item.customKv[index]
    if kv ~= nil and kv.key ~= nil and kv.valueType ~= nil then
      local ok_set, err = pcall(function()
        EditorAPI.set_unit_kv(uid, kv.key, editor_kv_value_type(kv.valueType), kv.value)
      end)
      if ok_set then
        ok_count = ok_count + 1
      else
        fail_count = fail_count + 1
        emit("KV_FAIL:" .. item.name .. ":" .. tostring(kv.key) .. ":" .. tostring(err))
      end
    end
  end
  return ok_count, fail_count
end

local found = 0
local missing = 0
local parent_missing = 0
local attached = 0
local kv_ok = 0
local kv_fail = 0

for index = 1, #ITEMS do
  local item = ITEMS[index]
  local uid = existing[item.name]
  local parent_uid = existing[item.parentName]
  if uid == nil then
    missing = missing + 1
    emit("MISSING:" .. item.name)
  else
    found = found + 1
    if parent_uid == nil then
      parent_missing = parent_missing + 1
      emit("PARENT_MISSING:" .. item.name .. ":" .. tostring(item.parentName))
    else
      if add_child(parent_uid, uid) then
        attached = attached + 1
      end
    end
    local ok_count, fail_count = apply_custom_kv(uid, item)
    kv_ok = kv_ok + ok_count
    kv_fail = kv_fail + fail_count
    local ok_parent_attr, parent_attr = pcall(function() return EditorAPI.get_unit_attr(uid, "parent_unit_id") end)
    local parent_name = ""
    if ok_parent_attr and parent_attr ~= nil then
      parent_name = by_id[tostring(parent_attr)] or tostring(parent_attr)
    end
    emit("ITEM:" .. item.name .. ":parent=" .. tostring(parent_name) .. ":expected=" .. item.parentName)
  end
end

emit(
  "DONE"
  .. ":total=" .. tostring(#ITEMS)
  .. ":found=" .. tostring(found)
  .. ":missing=" .. tostring(missing)
  .. ":parent_missing=" .. tostring(parent_missing)
  .. ":attached=" .. tostring(attached)
  .. ":kv_ok=" .. tostring(kv_ok)
  .. ":kv_fail=" .. tostring(kv_fail)
)
"""


def parse_result(log_text: str, run_id: str) -> dict[str, Any]:
    prefix = f"{TRIGGER_MARKER}:{run_id}:"
    result: dict[str, Any] = {
        "total": 0,
        "found": 0,
        "missing": 0,
        "parent_missing": 0,
        "attached": 0,
        "kv_ok": 0,
        "kv_fail": 0,
        "items": [],
        "errors": [],
    }
    for line in log_text.splitlines():
        if prefix not in line:
            continue
        payload = line.split(prefix, 1)[1].strip().strip('"')
        if payload.startswith("DONE"):
            for key, value in re.findall(r"([a-z_]+)=(\d+)", payload):
                if key in result:
                    result[key] = int(value)
        elif payload.startswith("ITEM:"):
            result["items"].append(payload)
        elif payload.startswith(("MISSING:", "PARENT_MISSING:", "KV_FAIL:")):
            result["errors"].append(payload)
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bind level 10 current trigger spaces to editor current groups.")
    add_workspace_argument(parser)
    add_editor_transport_arguments(parser)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = args.workspace.resolve()
    if args.dry_run:
        dump_json({"ok": True, "dry_run": True, "items": TRIGGERS}, compact=False)
        return 0

    run_id = str(int(time.time()))
    try:
        log_text = run_editor_lua_and_collect_logs(
            workspace,
            build_lua(run_id),
            mode=args.mode,
            backend_ws_url=args.backend_ws_url,
            timeout=args.timeout,
            progress=lambda msg: print(msg, file=sys.stderr),
            marker_prefixes=[TRIGGER_MARKER],
        )
    except Exception as exc:
        dump_json(error_payload(str(exc), tool="setup_tenth_current_triggers"), compact=False)
        return 1

    result = parse_result(log_text, run_id)
    ok = result["total"] == len(TRIGGERS) and result["found"] == len(TRIGGERS) and result["missing"] == 0 and result["parent_missing"] == 0 and result["kv_fail"] == 0
    dump_json({"ok": ok, "summary": result}, compact=False)
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
