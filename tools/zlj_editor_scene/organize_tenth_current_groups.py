#!/usr/bin/env python3
"""Organize level 10 current units into editor tree groups and apply group KV."""

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

from create_editor_scene import (  # noqa: E402
    MARKER,
    TENTH_CURRENT_PREFAB_ID,
    WALL_PREFAB_ID,
    build_plan,
    lua_custom_kv,
    lua_string,
    plan_item_dict,
    root_name,
)


GROUP_MARKER = f"{MARKER}_TENTH_CURRENT_GROUPS"


def lua_vec3(x: float, y: float, z: float) -> str:
    return f"math.Vector3({x:.6f}, {y:.6f}, {z:.6f})"


def lua_editor_item(item: dict[str, Any]) -> str:
    custom_kv = lua_custom_kv(item.get("custom_kv"))
    parent_name = item.get("parent_name")
    return (
        "{"
        f"name={lua_string(str(item['full_name']))}, "
        f"parentName={lua_string(str(parent_name)) if parent_name else 'nil'}, "
        f"prefabId={int(item['prefab_id'])}, "
        f"x={float(item['x']):.6f}, y={float(item['y']):.6f}, z={float(item['z']):.6f}, "
        f"sx={float(item['sx']):.6f}, sy={float(item['sy']):.6f}, sz={float(item['sz']):.6f}, "
        f"customKv={custom_kv}"
        "}"
    )


def select_tenth_current_items(workspace: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    groups: list[dict[str, Any]] = []
    currents: list[dict[str, Any]] = []
    for item in build_plan(workspace):
        data = plan_item_dict(item)
        kv = data.get("custom_kv") or {}
        role = kv.get("QRRole")
        if role == "tenth_current_group":
            groups.append(data)
        elif role == "tenth_current" and int(data.get("prefab_id", 0)) == TENTH_CURRENT_PREFAB_ID:
            currents.append(data)
    return groups, currents


def build_lua(groups: list[dict[str, Any]], currents: list[dict[str, Any]], run_id: str) -> str:
    group_body = ",\n".join(lua_editor_item(item) for item in groups)
    current_body = ",\n".join(lua_editor_item(item) for item in currents)
    return f"""
local RUN_ID = {lua_string(run_id)}
local MARKER = {lua_string(GROUP_MARKER)}
local ROOT_PREFAB_ID = {WALL_PREFAB_ID}
local LEVEL_ROOT_NAME = {lua_string(root_name(10))}
local GROUPS = {{
{group_body}
}}
local CURRENTS = {{
{current_body}
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

local function add_child(parent_uid, child_uid)
  if parent_uid == nil or child_uid == nil or EditorAPI.unit_add_child == nil then
    return false
  end
  local ok = pcall(function()
    return EditorAPI.unit_add_child(parent_uid, child_uid)
  end)
  return ok
end

local existing = {{}}
local ok_ids, ids = pcall(function() return EditorAPI.get_all_unit_ids() end)
if ok_ids and ids ~= nil then
  for i = 1, #ids do
    local uid = ids[i]
    local ok_name, name = pcall(function() return EditorAPI.get_unit_attr(uid, "name") end)
    if ok_name and name ~= nil then
      existing[tostring(name)] = uid
    end
  end
end

local created_groups = 0
local existing_groups = 0
local missing_currents = 0
local attached_groups = 0
local attached_currents = 0
local kv_applied_groups = 0
local kv_applied_currents = 0
local attr_set_currents = 0
local failed = 0

local function apply_custom_kv(uid, item)
  if uid == nil or item == nil or item.customKv == nil or EditorAPI.set_unit_kv == nil then
    return false
  end
  for index = 1, #item.customKv do
    local kv = item.customKv[index]
    if kv ~= nil and kv.key ~= nil and kv.valueType ~= nil then
      pcall(function()
        EditorAPI.set_unit_kv(uid, kv.key, editor_kv_value_type(kv.valueType), kv.value)
      end)
    end
  end
  return true
end

local function set_group_attrs(uid, item)
  pcall(function() EditorAPI.set_unit_attr(uid, "name", item.name) end)
  pcall(function() EditorAPI.set_unit_attr(uid, "position", math.Vector3(item.x, item.y, item.z)) end)
  pcall(function() EditorAPI.set_unit_attr(uid, "scale", math.Vector3(item.sx, item.sy, item.sz)) end)
  pcall(function() EditorAPI.set_unit_attr(uid, "model_alpha", 0) end)
  pcall(function() EditorAPI.set_unit_attr(uid, "init_model_visible", false) end)
  pcall(function() EditorAPI.set_unit_attr(uid, "physic_enable", false) end)
  pcall(function() EditorAPI.set_unit_attr(uid, "collision_enabled", false) end)
end

local function ensure_group(item)
  local uid = existing[item.name]
  local parent_uid = existing[item.parentName] or existing[LEVEL_ROOT_NAME]
  if uid == nil then
    local ok, created_uid = pcall(function()
      return EditorAPI.create_obstacle(ROOT_PREFAB_ID, math.Vector3(item.x, item.y, item.z), parent_uid or 0)
    end)
    if not ok then
      ok, created_uid = pcall(function()
        return EditorAPI.create_obstacle(ROOT_PREFAB_ID, math.Vector3(item.x, item.y, item.z))
      end)
    end
    if ok and created_uid ~= nil then
      uid = created_uid
      existing[item.name] = uid
      created_groups = created_groups + 1
    else
      failed = failed + 1
      emit("GROUP_CREATE_FAIL:" .. item.name .. ":" .. tostring(created_uid))
      return nil
    end
  else
    existing_groups = existing_groups + 1
  end
  if add_child(parent_uid, uid) then
    attached_groups = attached_groups + 1
  end
  set_group_attrs(uid, item)
  if apply_custom_kv(uid, item) then
    kv_applied_groups = kv_applied_groups + 1
  end
  return uid
end

for index = 1, #GROUPS do
  ensure_group(GROUPS[index])
end

for index = 1, #CURRENTS do
  local item = CURRENTS[index]
  local uid = existing[item.name]
  if uid == nil then
    missing_currents = missing_currents + 1
    emit("CURRENT_MISSING:" .. item.name)
  else
    local parent_uid = existing[item.parentName]
    if add_child(parent_uid, uid) then
      attached_currents = attached_currents + 1
    end
    pcall(function() EditorAPI.set_unit_attr(uid, "position", math.Vector3(item.x, item.y, item.z)) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "scale", math.Vector3(item.sx, item.sy, item.sz)) end)
    attr_set_currents = attr_set_currents + 1
    if apply_custom_kv(uid, item) then
      kv_applied_currents = kv_applied_currents + 1
    end
  end
end

emit(
  "DONE"
  .. ":groups=" .. tostring(#GROUPS)
  .. ":currents=" .. tostring(#CURRENTS)
  .. ":created_groups=" .. tostring(created_groups)
  .. ":existing_groups=" .. tostring(existing_groups)
  .. ":attached_groups=" .. tostring(attached_groups)
  .. ":attached_currents=" .. tostring(attached_currents)
  .. ":kv_applied_groups=" .. tostring(kv_applied_groups)
  .. ":kv_applied_currents=" .. tostring(kv_applied_currents)
  .. ":attr_set_currents=" .. tostring(attr_set_currents)
  .. ":missing_currents=" .. tostring(missing_currents)
  .. ":failed=" .. tostring(failed)
)
if missing_currents > 0 or failed > 0 then
  error(
    "tenth current group organize failed"
    .. ":groups=" .. tostring(#GROUPS)
    .. ":currents=" .. tostring(#CURRENTS)
    .. ":missing_currents=" .. tostring(missing_currents)
    .. ":failed=" .. tostring(failed)
  )
end
"""


def parse_summary(log_text: str, run_id: str) -> dict[str, int]:
    result = {
        "groups": 0,
        "currents": 0,
        "created_groups": 0,
        "existing_groups": 0,
        "attached_groups": 0,
        "attached_currents": 0,
        "kv_applied_groups": 0,
        "kv_applied_currents": 0,
        "attr_set_currents": 0,
        "missing_currents": 0,
        "failed": 0,
        "log_missing_batches": 0,
    }
    prefix = f"{GROUP_MARKER}:{run_id}:DONE"
    for line in log_text.splitlines():
        if prefix not in line:
            continue
        payload = line.split(prefix, 1)[1].strip().strip('"')
        for key, value in re.findall(r"([a-z_]+)=(\d+)", payload):
            if key in result:
                result[key] = int(value)
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Organize level 10 current units into editor tree groups.")
    add_workspace_argument(parser)
    add_editor_transport_arguments(parser)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch-size", type=int, default=20)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = args.workspace.resolve()
    groups, currents = select_tenth_current_items(workspace)
    if args.dry_run:
        dump_json(
            {
                "ok": True,
                "dry_run": True,
                "groups": len(groups),
                "currents": len(currents),
                "group_names": [item["full_name"] for item in groups],
            },
            compact=False,
        )
        return 0

    summary = {
        "groups": 0,
        "currents": 0,
        "created_groups": 0,
        "existing_groups": 0,
        "attached_groups": 0,
        "attached_currents": 0,
        "kv_applied_groups": 0,
        "kv_applied_currents": 0,
        "attr_set_currents": 0,
        "missing_currents": 0,
        "failed": 0,
        "log_missing_batches": 0,
    }

    batches: list[tuple[list[dict[str, Any]], list[dict[str, Any]]]] = [(groups, [])]
    batch_size = max(1, int(args.batch_size))
    for index in range(0, len(currents), batch_size):
        batches.append(([], currents[index : index + batch_size]))

    for batch_index, (batch_groups, batch_currents) in enumerate(batches, start=1):
        run_id = f"{int(time.time())}_{batch_index}"
        log_text = run_editor_lua_and_collect_logs(
            workspace,
            build_lua(batch_groups, batch_currents, run_id),
            mode=args.mode,
            backend_ws_url=args.backend_ws_url,
            timeout=args.timeout,
            progress=lambda msg: print(msg, file=sys.stderr),
            marker_prefixes=[GROUP_MARKER],
        )
        batch_summary = parse_summary(log_text, run_id)
        if batch_summary["groups"] == 0 and batch_summary["currents"] == 0 and (batch_groups or batch_currents):
            batch_summary["groups"] = len(batch_groups)
            batch_summary["currents"] = len(batch_currents)
            batch_summary["log_missing_batches"] = 1
        for key in summary:
            summary[key] += batch_summary[key]
        print(json.dumps({"batch": batch_index, "batches": len(batches), "summary": batch_summary}, ensure_ascii=False), file=sys.stderr)

    ok = summary["groups"] == len(groups) and summary["currents"] == len(currents) and summary["missing_currents"] == 0 and summary["failed"] == 0
    dump_json({"ok": ok, "batches": len(batches), "summary": summary}, compact=False)
    return 0 if ok else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        dump_json(error_payload(exc), compact=False)
        raise SystemExit(2)
