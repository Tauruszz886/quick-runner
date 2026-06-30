#!/usr/bin/env python3
"""Create or update level 1-9 victory coin trigger spaces in the editor scene."""

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


COIN_MARKER = f"{MARKER}_VICTORY_COIN_TRIGGERS"
TRIGGER_PREFAB_ID = 3101010
TRIGGER_SCALE = {"sx": 5.0, "sy": 3.0, "sz": 5.0}
TRIGGER_Y = 8.0
COIN_REWARD = 5

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

# Most levels use the first level's manually placed local finish offset.
# Level 6 and 9 finish platforms are shorter, so use their actual finish platform centers.
TRIGGER_POSITIONS: dict[int, tuple[float, float, float]] = {
    1: (694.5, TRIGGER_Y, -17.5),
    2: (534.5, TRIGGER_Y, -17.5),
    3: (374.5, TRIGGER_Y, -17.5),
    4: (214.5, TRIGGER_Y, -17.5),
    5: (54.5, TRIGGER_Y, -17.5),
    6: (-113.0, TRIGGER_Y, -36.0),
    7: (-265.5, TRIGGER_Y, -17.5),
    8: (-425.5, TRIGGER_Y, -17.5),
    9: (-593.5, TRIGGER_Y, -36.0),
}


def level_name(level: int) -> str:
    return f"第{CHINESE_LEVELS[level]}关胜利获取金币区域"


def root_name(level: int) -> str:
    return f"QR_第{level:02d}关_ROOT"


def custom_kv(level: int) -> dict[str, Any]:
    return {
        "QRRole": "first_victory_coin_trigger",
        "QRModule": level,
        "QRComponent": "胜利获取金币区域",
        "QRRuntimeName": level_name(level),
        "QRCoins": COIN_REWARD,
        "QRRespawnAtBirth": True,
        "胜利获取金币": True,
        "玩家胜利区域": True,
        "死亡在出生点复活并且获取5金币": True,
    }


def lua_item(level: int) -> str:
    x, y, z = TRIGGER_POSITIONS[level]
    return (
        "{"
        f"level={level}, "
        f"name={lua_string(level_name(level))}, "
        f"rootName={lua_string(root_name(level))}, "
        f"prefabId={TRIGGER_PREFAB_ID}, "
        f"x={x:.6f}, y={y:.6f}, z={z:.6f}, "
        f"sx={TRIGGER_SCALE['sx']:.6f}, sy={TRIGGER_SCALE['sy']:.6f}, sz={TRIGGER_SCALE['sz']:.6f}, "
        f"customKv={lua_custom_kv(custom_kv(level))}"
        "}"
    )


def parse_levels(text: str) -> list[int]:
    levels: list[int] = []
    for raw_part in text.split(","):
        part = raw_part.strip()
        if not part:
            continue
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            levels.extend(range(int(start_text), int(end_text) + 1))
        else:
            levels.append(int(part))

    out: list[int] = []
    seen: set[int] = set()
    for level in levels:
        if level < 1 or level > 9:
            raise ValueError(f"level out of range: {level}")
        if level in seen:
            continue
        seen.add(level)
        out.append(level)
    return out


def build_lua(run_id: str, levels: list[int]) -> str:
    items = ",\n".join(lua_item(level) for level in levels)
    return f"""
local RUN_ID = {lua_string(run_id)}
local MARKER = {lua_string(COIN_MARKER)}
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

local function add_child(parent_uid, child_uid)
  if parent_uid == nil or child_uid == nil or EditorAPI.unit_add_child == nil then
    return false
  end
  local ok, result = pcall(function()
    return EditorAPI.unit_add_child(parent_uid, child_uid)
  end)
  return ok and result ~= false
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
  if source_uid == nil or target_uid == nil then
    return false
  end
  local ok_get, value = pcall(function()
    return EditorAPI.get_unit_attr(source_uid, key)
  end)
  if not ok_get or value == nil then
    return false
  end
  return set_attr(target_uid, key, value)
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
      record("KV_FAIL:" .. item.name .. ":" .. tostring(kv.key) .. ":" .. tostring(err))
    end
  end
  return ok_count, fail_count
end

local template_uid = get_by_name("第一关胜利获取金币区域")
local created = 0
local updated = 0
local missing_root = 0
local attached = 0
local kv_ok = 0
local kv_fail = 0
local failed = 0

for index = 1, #ITEMS do
  local item = ITEMS[index]
  local root_uid = get_by_name(item.rootName)
  if root_uid == nil then
    missing_root = missing_root + 1
    record("ROOT_MISSING:" .. item.name .. ":" .. item.rootName)
  else
    local uid = get_by_name(item.name)
    if uid == nil then
      local ok_create, created_uid = pcall(function()
        return EditorAPI.create_obstacle(item.prefabId, math.Vector3(item.x, item.y, item.z), root_uid)
      end)
      if not ok_create then
        ok_create, created_uid = pcall(function()
          return EditorAPI.create_obstacle(item.prefabId, math.Vector3(item.x, item.y, item.z))
        end)
      end
      if ok_create and created_uid ~= nil then
        uid = created_uid
        created = created + 1
        existing[item.name] = uid
      else
        failed = failed + 1
        record("CREATE_FAIL:" .. item.name .. ":" .. tostring(created_uid))
      end
    else
      updated = updated + 1
    end

    if uid ~= nil then
      set_attr(uid, "name", item.name)
      set_attr(uid, "position", math.Vector3(item.x, item.y, item.z))
      set_attr(uid, "scale", math.Vector3(item.sx, item.sy, item.sz))
      set_attr(uid, "model_alpha", 0)
      set_attr(uid, "init_model_visible", false)
      set_attr(uid, "unit_auto_opti", false)
      set_attr(uid, "physic_enable", false)
      if template_uid ~= nil then
        copy_attr(template_uid, uid, "model_angle")
        copy_attr(template_uid, uid, "trigger_effective_rule")
        copy_attr(template_uid, uid, "trigger_effective_mask")
        copy_attr(template_uid, uid, "trigger_valid_mask")
        copy_attr(template_uid, uid, "collision_enabled")
      end
      if add_child(root_uid, uid) then
        attached = attached + 1
      end
      local ok_count, fail_count = apply_custom_kv(uid, item)
      kv_ok = kv_ok + ok_count
      kv_fail = kv_fail + fail_count
      record(
        "ITEM:" .. tostring(item.level)
        .. ":" .. item.name
        .. ":uid=" .. tostring(uid)
        .. ":root=" .. item.rootName
        .. ":pos=" .. tostring(item.x) .. "," .. tostring(item.y) .. "," .. tostring(item.z)
        .. ":kv_ok=" .. tostring(ok_count)
        .. ":kv_fail=" .. tostring(fail_count)
      )
    end
  end
end

emit(
  "DONE"
  .. ":total=" .. tostring(#ITEMS)
  .. ":template=" .. tostring(template_uid)
  .. ":created=" .. tostring(created)
  .. ":updated=" .. tostring(updated)
  .. ":missing_root=" .. tostring(missing_root)
  .. ":attached=" .. tostring(attached)
  .. ":kv_ok=" .. tostring(kv_ok)
  .. ":kv_fail=" .. tostring(kv_fail)
  .. ":failed=" .. tostring(failed)
)
for index = 1, #MESSAGES do
  emit(MESSAGES[index])
end
"""


def parse_result(log_text: str, run_id: str) -> dict[str, Any]:
    prefix = f"{COIN_MARKER}:{run_id}:"
    result: dict[str, Any] = {
        "total": 0,
        "template": "nil",
        "created": 0,
        "updated": 0,
        "missing_root": 0,
        "attached": 0,
        "kv_ok": 0,
        "kv_fail": 0,
        "failed": 0,
        "items": [],
        "errors": [],
    }
    for line in log_text.splitlines():
        if prefix not in line:
            continue
        payload = line.split(prefix, 1)[1].strip().strip('"')
        if payload.startswith("DONE"):
            for key, value in re.findall(r"([a-z_]+)=([^:]+)", payload):
                if key in {"template"}:
                    result[key] = value
                elif key in result and re.fullmatch(r"-?\\d+", value):
                    result[key] = int(value)
        elif payload.startswith("ITEM:"):
            result["items"].append(payload)
        elif payload.startswith(("ROOT_MISSING:", "CREATE_FAIL:", "KV_FAIL:", "ATTR_FAIL:")):
            result["errors"].append(payload)
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create/update level 1-9 victory coin trigger spaces.")
    add_workspace_argument(parser)
    add_editor_transport_arguments(parser)
    parser.add_argument("--levels", default="1-9", help="要处理的关卡，例如 4 或 4-9 或 1,3,5。")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = args.workspace.resolve()
    levels = parse_levels(args.levels)
    if args.dry_run:
        dump_json(
            {
                "ok": True,
                "dry_run": True,
                "items": [
                    {
                        "level": level,
                        "name": level_name(level),
                        "root": root_name(level),
                        "position": TRIGGER_POSITIONS[level],
                        "scale": TRIGGER_SCALE,
                        "custom_kv": custom_kv(level),
                    }
                    for level in levels
                ],
            },
            compact=False,
        )
        return 0

    run_id = str(time.time_ns())
    try:
        log_text = run_editor_lua_and_collect_logs(
            workspace,
            build_lua(run_id, levels),
            mode=args.mode,
            backend_ws_url=args.backend_ws_url,
            timeout=args.timeout,
            progress=lambda msg: print(msg, file=sys.stderr),
            marker_prefixes=[COIN_MARKER],
        )
    except Exception as exc:
        dump_json(error_payload(str(exc), tool="setup_level_victory_coin_triggers"), compact=False)
        return 1

    result = parse_result(log_text, run_id)
    ok = (
        result["total"] == len(levels)
        and len(result["items"]) == len(levels)
        and result["missing_root"] == 0
        and result["kv_fail"] == 0
        and result["failed"] == 0
        and not result["errors"]
    )
    dump_json({"ok": ok, "summary": result}, compact=False)
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
