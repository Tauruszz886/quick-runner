#!/usr/bin/env python3
"""Set up level teleport trigger areas in the editor scene."""

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

from eggitor_agent.bridge import local_agent_request, resolve_bridge_auth  # noqa: E402
from eggitor_agent.cli import add_workspace_argument, dump_json, error_payload  # noqa: E402


MARKER = "QR_LEVEL_TELEPORT_SETUP"


def lua_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def build_lua(run_id: str) -> str:
    return f"""
local RUN_ID = {lua_string(run_id)}
local MARKER = {lua_string(MARKER)}
local FIRST_LEVEL_CENTER_X = 759.0
local CENTER_STEP_X = 160.0
local DEFAULT_TRIGGER_PREFAB_ID = 3101010

local CHINESE_NUMBERS = {{
  [1] = "一",
  [2] = "二",
  [3] = "三",
  [4] = "四",
  [5] = "五",
  [6] = "六",
  [7] = "七",
  [8] = "八",
  [9] = "九",
  [10] = "十",
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

local function vec_to_text(value)
  local x, y, z = vec_to_xyz(value)
  if x == nil then
    return tostring(value)
  end
  return tostring(x) .. "," .. tostring(y) .. "," .. tostring(z)
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

local existing_by_name = {{}}
local all_ids = {{}}
local ok_ids, ids = pcall(function()
  return EditorAPI.get_all_unit_ids()
end)
if ok_ids and ids ~= nil then
  all_ids = ids
  for index = 1, #ids do
    local uid = ids[index]
    local name = attr(uid, "name")
    if name ~= nil and existing_by_name[tostring(name)] == nil then
      existing_by_name[tostring(name)] = uid
    end
  end
end

local function query_by_name(name)
  local direct = existing_by_name[name]
  if direct ~= nil then
    return direct
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

local function level_name(level)
  return "第" .. CHINESE_NUMBERS[level] .. "关传送点"
end

local function level_center_x(level)
  return FIRST_LEVEL_CENTER_X - CENTER_STEP_X * (level - 1)
end

local function level_root_name_candidates(level)
  local chinese = CHINESE_NUMBERS[level]
  return {{
    string.format("QR_第%02d关_ROOT", level),
    string.format("QR_第%d关_ROOT", level),
    "QR_第" .. chinese .. "关_ROOT",
    string.format("第%02d关_ROOT", level),
    string.format("第%d关_ROOT", level),
    "第" .. chinese .. "关_ROOT",
  }}
end

local function find_level_root(level)
  local candidates = level_root_name_candidates(level)
  for index = 1, #candidates do
    local uid = query_by_name(candidates[index])
    if uid ~= nil then
      return uid, candidates[index]
    end
  end
  return nil, "none"
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

local function set_bool_kv(uid, key, value)
  if uid == nil or EditorAPI.set_unit_kv == nil then
    return false
  end
  local ok, err = pcall(function()
    return EditorAPI.set_unit_kv(uid, key, editor_kv_value_type("Bool"), value)
  end)
  if not ok then
    emit("KV_FAIL:" .. tostring(uid) .. ":" .. key .. ":" .. tostring(err))
    return false
  end
  return true
end

local function copy_optional_attr(src_uid, dst_uid, key)
  local value = attr(src_uid, key)
  if value ~= nil then
    pcall(function()
      EditorAPI.set_unit_attr(dst_uid, key, value)
    end)
  end
end

local first_uid = query_by_name("第一关传送点") or query_by_name("QR_第一关传送点")
if first_uid == nil then
  emit("ERROR:first_teleport_not_found")
  return
end

local first_position = attr(first_uid, "position")
local first_scale = attr(first_uid, "scale") or math.Vector3(1, 1, 1)
local first_angle = attr(first_uid, "model_angle")
local first_prefab = attr(first_uid, "unit_eid") or DEFAULT_TRIGGER_PREFAB_ID
local first_parent_uid = attr(first_uid, "parent_unit_id")
local first_parent_name = first_parent_uid ~= nil and attr(first_parent_uid, "name") or "none"
local first_x, first_y, first_z = vec_to_xyz(first_position)
if first_x == nil or first_y == nil or first_z == nil then
  emit("ERROR:first_position_invalid:" .. tostring(first_uid) .. ":" .. tostring(first_position))
  return
end

local offset_x = first_x - FIRST_LEVEL_CENTER_X
local use_local_position = first_parent_uid ~= nil and math.abs(first_x) < 240 and math.abs(first_x - FIRST_LEVEL_CENTER_X) > 240
local created = 0
local updated = 0
local failed = 0
local kv_ok = 0
local attached = 0

for level = 1, 10 do
  local name = level_name(level)
  local uid = nil
  if level == 1 then
    uid = first_uid
    pcall(function() EditorAPI.set_unit_attr(uid, "name", name) end)
  else
    uid = query_by_name(name)
  end

  local target_x = first_x
  if use_local_position ~= true then
    target_x = level_center_x(level) + offset_x
  end
  local target_pos = math.Vector3(target_x, first_y, first_z)
  local parent_uid, parent_name = find_level_root(level)

  if uid == nil then
    local ok_create, created_uid = pcall(function()
      return EditorAPI.create_obstacle(first_prefab, target_pos, parent_uid or 0)
    end)
    if not ok_create then
      ok_create, created_uid = pcall(function()
        return EditorAPI.create_obstacle(first_prefab, target_pos)
      end)
    end
    if ok_create and created_uid ~= nil then
      uid = created_uid
      created = created + 1
      existing_by_name[name] = uid
    else
      failed = failed + 1
      emit("ITEM_FAIL:" .. name .. ":create:" .. tostring(created_uid))
    end
  else
    updated = updated + 1
  end

  if uid ~= nil then
    pcall(function() EditorAPI.set_unit_attr(uid, "name", name) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "position", target_pos) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "scale", first_scale) end)
    if first_angle ~= nil then
      pcall(function() EditorAPI.set_unit_attr(uid, "model_angle", first_angle) end)
    end
    copy_optional_attr(first_uid, uid, "model_alpha")
    copy_optional_attr(first_uid, uid, "init_model_visible")
    copy_optional_attr(first_uid, uid, "physic_enable")
    copy_optional_attr(first_uid, uid, "collision_enabled")
    copy_optional_attr(first_uid, uid, "trigger_effective_rule")
    copy_optional_attr(first_uid, uid, "trigger_effective_mask")
    copy_optional_attr(first_uid, uid, "trigger_valid_mask")
    if parent_uid ~= nil and add_child(parent_uid, uid) then
      attached = attached + 1
    end
    if set_bool_kv(uid, "可传送", true) then
      kv_ok = kv_ok + 1
    end
    emit(
      "ITEM:" .. tostring(level)
      .. ":" .. name
      .. ":uid=" .. tostring(uid)
      .. ":parent=" .. tostring(parent_name)
      .. ":pos=" .. vec_to_text(target_pos)
      .. ":scale=" .. vec_to_text(first_scale)
    )
  end
end

emit(
  "DONE:first_uid=" .. tostring(first_uid)
  .. ":prefab=" .. tostring(first_prefab)
  .. ":first_parent=" .. tostring(first_parent_name)
  .. ":position_mode=" .. (use_local_position and "local" or "world")
  .. ":offset_x=" .. tostring(offset_x)
  .. ":created=" .. tostring(created)
  .. ":updated=" .. tostring(updated)
  .. ":failed=" .. tostring(failed)
  .. ":kv_ok=" .. tostring(kv_ok)
  .. ":attached=" .. tostring(attached)
)
"""


def collect_marker_messages(response: dict[str, Any], run_id: str) -> list[str]:
    result = response.get("result") if isinstance(response, dict) else None
    messages: list[str] = []
    if isinstance(result, dict):
        raw_messages = result.get("matched_log_messages")
        if isinstance(raw_messages, list):
            messages.extend(str(message) for message in raw_messages)
        for key in ("log_tail", "editor_logs_stdout"):
            text = result.get(key)
            if not isinstance(text, str):
                continue
            for line in text.splitlines():
                if MARKER in line:
                    message = line.split(MARKER, 1)[1].lstrip(": ")
                    messages.append(MARKER + message)
    prefix = f"{MARKER}:{run_id}:"
    unique: list[str] = []
    seen: set[str] = set()
    for message in messages:
        if prefix not in message:
            continue
        normalized = message[message.index(prefix) :]
        if normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)
    return unique


def parse_summary(messages: list[str], run_id: str) -> dict[str, Any]:
    prefix = f"{MARKER}:{run_id}:"
    items: list[dict[str, Any]] = []
    summary: dict[str, Any] = {}
    errors: list[str] = []
    for message in messages:
        payload = message[len(prefix) :] if message.startswith(prefix) else message
        if payload.startswith("ERROR:"):
            errors.append(payload)
            continue
        if payload.startswith("ITEM_FAIL:"):
            errors.append(payload)
            continue
        if payload.startswith("ITEM:"):
            match = re.match(r"ITEM:(\d+):([^:]+):uid=([^:]+):parent=([^:]+):pos=([^:]+):scale=(.+)", payload)
            if match:
                items.append(
                    {
                        "level": int(match.group(1)),
                        "name": match.group(2),
                        "uid": match.group(3),
                        "parent": match.group(4),
                        "position": match.group(5),
                        "scale": match.group(6),
                    }
                )
            continue
        if payload.startswith("DONE:"):
            for part in payload.split(":")[1:]:
                if "=" not in part:
                    continue
                key, value = part.split("=", 1)
                if re.fullmatch(r"-?\d+", value):
                    summary[key] = int(value)
                elif re.fullmatch(r"-?\d+(\.\d+)?", value):
                    summary[key] = float(value)
                else:
                    summary[key] = value
    return {"items": items, "summary": summary, "errors": errors}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Set 可传送 KV and copy level teleport points from 第一关传送点.")
    add_workspace_argument(parser)
    parser.add_argument("--timeout", type=int, default=30, help="local-agent 请求超时时间（秒）。")
    parser.add_argument("--compact", action="store_true", help="输出紧凑 JSON。")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = args.workspace.resolve()
    ws_url, token = resolve_bridge_auth(workspace)
    run_id = str(int(time.time()))
    response = local_agent_request(
        ws_url,
        "editor.exec_collect_logs",
        {
            "lua": build_lua(run_id),
            "timeout_ms": int(args.timeout) * 1000,
            "marker_prefixes": [MARKER],
        },
        int(args.timeout) + 10,
        token=token,
        raise_on_error=False,
    )
    messages = collect_marker_messages(response, run_id)
    parsed = parse_summary(messages, run_id)
    summary = parsed["summary"]
    ok = (
        response.get("ok") is True
        and not parsed["errors"]
        and int(summary.get("failed", -1)) == 0
        and int(summary.get("kv_ok", 0)) == 10
        and len(parsed["items"]) == 10
    )
    dump_json(
        {
            "ok": ok,
            "run_id": run_id,
            "summary": summary,
            "items": parsed["items"],
            "errors": parsed["errors"],
            "raw_ok": response.get("ok"),
        },
        compact=args.compact,
    )
    return 0 if ok else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        dump_json(error_payload(exc), compact=False)
        raise SystemExit(2)
