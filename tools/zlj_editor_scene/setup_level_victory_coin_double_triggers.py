#!/usr/bin/env python3
"""Create or update level 1-9 double victory coin trigger spaces."""

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


DOUBLE_MARKER = f"{MARKER}_VICTORY_COIN_DOUBLE_TRIGGERS"
TRIGGER_PREFAB_ID = 3101010
DEFAULT_MIRROR_CENTER_Z = -34.0

CHINESE_LEVELS = {
    1: "一",
    2: "二",
    3: "三",
    4: "四",
    5: "五",
    6: "六",
    7: "七",
    8: "八",
    9: "九",
}


def normal_name(level: int) -> str:
    return f"第{CHINESE_LEVELS[level]}关胜利获取金币区域"


def double_name(level: int) -> str:
    return f"第{CHINESE_LEVELS[level]}关胜利获取金币2倍区"


def root_name(level: int) -> str:
    return f"QR_第{level:02d}关_ROOT"


def custom_kv(level: int) -> dict[str, Any]:
    return {
        "QRRole": "victory_coin_double_trigger",
        "QRModule": level,
        "QRComponent": "胜利获取金币2倍区",
        "QRRuntimeName": double_name(level),
        "QRBaseRewardSourceRuntimeName": normal_name(level),
        "QRRewardMultiplier": 2,
        "QRRespawnAtBirth": True,
        "胜利获取金币双倍": True,
        "双倍金币需通过充值购买获得": True,
    }


def lua_item(level: int) -> str:
    return (
        "{"
        f"level={level}, "
        f"normalName={lua_string(normal_name(level))}, "
        f"doubleName={lua_string(double_name(level))}, "
        f"rootName={lua_string(root_name(level))}, "
        f"prefabId={TRIGGER_PREFAB_ID}, "
        f"customKv={lua_custom_kv(custom_kv(level))}"
        "}"
    )


def build_lua(run_id: str) -> str:
    items = ",\n".join(lua_item(level) for level in range(1, 10))
    return f"""
local RUN_ID = {lua_string(run_id)}
local MARKER = {lua_string(DOUBLE_MARKER)}
local DEFAULT_MIRROR_CENTER_Z = {DEFAULT_MIRROR_CENTER_Z:.6f}
local ITEMS = {{
{items}
}}
local MESSAGES = {{}}

local function record(msg)
  MESSAGES[#MESSAGES + 1] = msg
end

local function emit(msg)
  EditorAPI.log(MARKER .. ":" .. RUN_ID .. ":" .. msg)
end

local function editor_kv_value_type(type_name)
  if Enums ~= nil and Enums.ValueType ~= nil and Enums.ValueType[type_name] ~= nil then
    return Enums.ValueType[type_name]
  end
  return type_name
end

local function parse_decimal(text)
  local sign = 1
  local index = 1
  if string.sub(text, 1, 1) == "-" then
    sign = -1
    index = 2
  end
  local value = 0
  local divisor = 1
  local in_fraction = false
  for i = index, #text do
    local ch = string.sub(text, i, i)
    if ch == "." then
      in_fraction = true
    else
      local digit = string.byte(ch) - string.byte("0")
      if digit >= 0 and digit <= 9 then
        if in_fraction then
          divisor = divisor * 10
          value = value + digit / divisor
        else
          value = value * 10 + digit
        end
      end
    end
  end
  return sign * value
end

local function vec_to_xyz(value)
  if type(value) ~= "table" then
    local text = tostring(value)
    local x, y, z = string.match(text, "Vector3%(([^,]+),([^,]+),([^%)]+)%)")
    if x ~= nil then
      return parse_decimal(x), parse_decimal(y), parse_decimal(z)
    end
    return nil, nil, nil
  end
  return value.x or value.X or value[1], value.y or value.Y or value[2], value.z or value.Z or value[3]
end

local existing = {{}}
local ok_ids, ids = pcall(function()
  return EditorAPI.get_all_unit_ids()
end)
if ok_ids and ids ~= nil then
  for index = 1, #ids do
    local uid = ids[index]
    local ok_name, name = pcall(function()
      return EditorAPI.get_unit_attr(uid, "name")
    end)
    if ok_name and name ~= nil and existing[tostring(name)] == nil then
      existing[tostring(name)] = uid
    end
  end
end

local function get_by_name(name)
  if existing[name] ~= nil then
    return existing[name]
  end
  local ok_query, result = pcall(function()
    return EditorAPI.query_unit_ids(name, false)
  end)
  if ok_query and result ~= nil and #result > 0 then
    local item = result[1]
    if type(item) == "table" then
      return item.id or item.uid or item.unit_id or item[1]
    end
    return item
  end
  return nil
end

local function attr(uid, key)
  local ok, value = pcall(function()
    return EditorAPI.get_unit_attr(uid, key)
  end)
  if ok then
    return value
  end
  return nil
end

local function set_attr(uid, key, value)
  local ok, err = pcall(function()
    return EditorAPI.set_unit_attr(uid, key, value)
  end)
  if not ok then
    record("ATTR_FAIL:" .. tostring(uid) .. ":" .. tostring(key) .. ":" .. tostring(err))
    return false
  end
  return true
end

local function copy_attr(source_uid, target_uid, key)
  local value = attr(source_uid, key)
  if value == nil then
    return false
  end
  return set_attr(target_uid, key, value)
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
  for index = 1, #item.customKv do
    local kv = item.customKv[index]
    local ok_set, err = pcall(function()
      return EditorAPI.set_unit_kv(uid, kv.key, editor_kv_value_type(kv.valueType), kv.value)
    end)
    if ok_set then
      ok_count = ok_count + 1
    else
      fail_count = fail_count + 1
      record("KV_FAIL:" .. item.doubleName .. ":" .. tostring(kv.key) .. ":" .. tostring(err))
    end
  end
  return ok_count, fail_count
end

local ninth_normal_uid = get_by_name("第九关胜利获取金币区域")
local ninth_double_uid = get_by_name("第九关胜利获取金币2倍区")
local mirror_center_z = DEFAULT_MIRROR_CENTER_Z
if ninth_normal_uid ~= nil and ninth_double_uid ~= nil then
  local normal_pos = attr(ninth_normal_uid, "position")
  local double_pos = attr(ninth_double_uid, "position")
  local _, _, normal_z = vec_to_xyz(normal_pos)
  local _, _, double_z = vec_to_xyz(double_pos)
  if normal_z ~= nil and double_z ~= nil then
    mirror_center_z = (normal_z + double_z) / 2
  end
end

local created = 0
local updated = 0
local missing_normal = 0
local missing_root = 0
local attached = 0
local kv_ok = 0
local kv_fail = 0
local failed = 0

for index = 1, #ITEMS do
  local item = ITEMS[index]
  local normal_uid = get_by_name(item.normalName)
  local root_uid = get_by_name(item.rootName)
  if normal_uid == nil then
    missing_normal = missing_normal + 1
    record("NORMAL_MISSING:" .. item.normalName)
  elseif root_uid == nil then
    missing_root = missing_root + 1
    record("ROOT_MISSING:" .. item.rootName)
  else
    local uid = get_by_name(item.doubleName)
    local normal_pos = attr(normal_uid, "position")
    local normal_x, normal_y, normal_z = vec_to_xyz(normal_pos)
    if normal_x == nil or normal_y == nil or normal_z == nil then
      failed = failed + 1
      record("NORMAL_POSITION_INVALID:" .. item.normalName)
    else
      local target_x = normal_x
      local target_y = normal_y
      local target_z = mirror_center_z * 2 - normal_z
      if uid ~= nil and item.level == 9 then
        local current_pos = attr(uid, "position")
        local current_x, current_y, current_z = vec_to_xyz(current_pos)
        if current_x ~= nil and current_y ~= nil and current_z ~= nil then
          target_x = current_x
          target_y = current_y
          target_z = current_z
        end
      end
      if uid == nil then
        local ok_create, created_uid = pcall(function()
          return EditorAPI.create_obstacle(item.prefabId, math.Vector3(target_x, target_y, target_z), root_uid)
        end)
        if not ok_create then
          ok_create, created_uid = pcall(function()
            return EditorAPI.create_obstacle(item.prefabId, math.Vector3(target_x, target_y, target_z))
          end)
        end
        if ok_create and created_uid ~= nil then
          uid = created_uid
          existing[item.doubleName] = uid
          created = created + 1
        else
          failed = failed + 1
          record("CREATE_FAIL:" .. item.doubleName .. ":" .. tostring(created_uid))
        end
      else
        updated = updated + 1
      end
      if uid ~= nil then
        set_attr(uid, "name", item.doubleName)
        set_attr(uid, "position", math.Vector3(target_x, target_y, target_z))
        copy_attr(normal_uid, uid, "scale")
        copy_attr(normal_uid, uid, "model_angle")
        copy_attr(normal_uid, uid, "trigger_effective_rule")
        copy_attr(normal_uid, uid, "trigger_effective_mask")
        copy_attr(normal_uid, uid, "trigger_valid_mask")
        copy_attr(normal_uid, uid, "collision_enabled")
        set_attr(uid, "model_alpha", 0)
        set_attr(uid, "init_model_visible", false)
        set_attr(uid, "unit_auto_opti", false)
        set_attr(uid, "physic_enable", false)
        if add_child(root_uid, uid) then
          attached = attached + 1
        end
        local ok_count, fail_count = apply_custom_kv(uid, item)
        kv_ok = kv_ok + ok_count
        kv_fail = kv_fail + fail_count
        record(
          "ITEM:" .. tostring(item.level)
          .. ":" .. item.doubleName
          .. ":uid=" .. tostring(uid)
          .. ":root=" .. item.rootName
          .. ":pos=" .. tostring(target_x) .. "," .. tostring(target_y) .. "," .. tostring(target_z)
          .. ":kv_ok=" .. tostring(ok_count)
          .. ":kv_fail=" .. tostring(fail_count)
        )
      end
    end
  end
end

emit(
  "DONE"
  .. ":total=" .. tostring(#ITEMS)
  .. ":created=" .. tostring(created)
  .. ":updated=" .. tostring(updated)
  .. ":missing_normal=" .. tostring(missing_normal)
  .. ":missing_root=" .. tostring(missing_root)
  .. ":attached=" .. tostring(attached)
  .. ":kv_ok=" .. tostring(kv_ok)
  .. ":kv_fail=" .. tostring(kv_fail)
  .. ":failed=" .. tostring(failed)
  .. ":mirror_center_z=" .. tostring(mirror_center_z)
)
for index = 1, #MESSAGES do
  emit(MESSAGES[index])
end
"""


def parse_result(log_text: str, run_id: str) -> dict[str, Any]:
    prefix = f"{DOUBLE_MARKER}:{run_id}:"
    result: dict[str, Any] = {
        "total": 0,
        "created": 0,
        "updated": 0,
        "missing_normal": 0,
        "missing_root": 0,
        "attached": 0,
        "kv_ok": 0,
        "kv_fail": 0,
        "failed": 0,
        "mirror_center_z": None,
        "items": [],
        "errors": [],
    }
    for line in log_text.splitlines():
        if prefix not in line:
            continue
        payload = line.split(prefix, 1)[1].strip().strip('"')
        if payload.startswith("DONE"):
            for key, value in re.findall(r"([a-z_]+)=([^:]+)", payload):
                if key == "mirror_center_z":
                    result[key] = float(value)
                elif key in result and re.fullmatch(r"-?\d+", value):
                    result[key] = int(value)
        elif payload.startswith("ITEM:"):
            result["items"].append(payload)
        elif payload.startswith(("NORMAL_MISSING:", "ROOT_MISSING:", "KV_FAIL:", "ATTR_FAIL:", "CREATE_FAIL:", "NORMAL_POSITION_INVALID:")):
            result["errors"].append(payload)
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create/update level 1-9 double victory coin trigger spaces.")
    add_workspace_argument(parser)
    add_editor_transport_arguments(parser)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = args.workspace.resolve()
    if args.dry_run:
        dump_json(
            {
                "ok": True,
                "dry_run": True,
                "items": [
                    {
                        "level": level,
                        "normal_name": normal_name(level),
                        "double_name": double_name(level),
                        "root": root_name(level),
                        "custom_kv": custom_kv(level),
                    }
                    for level in range(1, 10)
                ],
            },
            compact=False,
        )
        return 0

    run_id = str(time.time_ns())
    try:
        log_text = run_editor_lua_and_collect_logs(
            workspace,
            build_lua(run_id),
            mode=args.mode,
            backend_ws_url=args.backend_ws_url,
            timeout=args.timeout,
            progress=lambda msg: print(msg, file=sys.stderr),
            marker_prefixes=[DOUBLE_MARKER],
        )
    except Exception as exc:
        dump_json(error_payload(str(exc), tool="setup_level_victory_coin_double_triggers"), compact=False)
        return 1

    result = parse_result(log_text, run_id)
    ok = (
        result["total"] == 9
        and len(result["items"]) == 9
        and result["missing_normal"] == 0
        and result["missing_root"] == 0
        and result["kv_fail"] == 0
        and result["failed"] == 0
        and not result["errors"]
    )
    dump_json({"ok": ok, "summary": result}, compact=False)
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
