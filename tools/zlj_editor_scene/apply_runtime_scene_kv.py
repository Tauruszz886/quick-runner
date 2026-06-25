#!/usr/bin/env python3
"""Apply quick-runner runtime custom KV to editor scene units.

This script is intentionally narrower than create_editor_scene.py: it does not
update normal terrain geometry. It only applies custom KV to planned runtime
units, and can optionally create missing runtime trigger units such as
fall_death zones.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass
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

from create_editor_scene import MARKER, SceneItem, build_plan, lua_custom_kv, lua_string, plan_item_dict  # noqa: E402


KV_MARKER = f"{MARKER}_KV"


@dataclass
class RuntimeKvItem:
    item: SceneItem

    @property
    def role(self) -> str:
        assert self.item.custom_kv is not None
        return str(self.item.custom_kv.get("QRRole", ""))


def select_items(
    plan: list[SceneItem],
    roles: set[str],
    create_missing_runtime_triggers: bool,
) -> list[RuntimeKvItem]:
    selected: list[RuntimeKvItem] = []
    for item in plan:
        if not item.custom_kv:
            continue
        role = str(item.custom_kv.get("QRRole", ""))
        if roles and role not in roles:
            continue
        if item.runtime_trigger or not create_missing_runtime_triggers:
            selected.append(RuntimeKvItem(item))
        else:
            selected.append(RuntimeKvItem(item))
    return selected


def lua_runtime_item(item: SceneItem) -> str:
    runtime_trigger = "true" if item.runtime_trigger else "false"
    return (
        "{"
        f"name={lua_string(item.full_name)}, legacyName={lua_string(item.legacy_full_name)}, parentName={lua_string(item.parent_name)}, "
        f"prefabId={item.prefab_id}, x={item.x:.6f}, y={item.y:.6f}, z={item.z:.6f}, "
        f"sx={item.sx:.6f}, sy={item.sy:.6f}, sz={item.sz:.6f}, "
        f"runtimeTrigger={runtime_trigger}, customKv={lua_custom_kv(item.custom_kv)}"
        "}"
    )


def build_lua(items: list[RuntimeKvItem], run_id: str, create_missing_runtime_triggers: bool) -> str:
    body = ",\n".join(lua_runtime_item(item.item) for item in items)
    create_missing = "true" if create_missing_runtime_triggers else "false"
    return f"""
local RUN_ID = {lua_string(run_id)}
local MARKER = {lua_string(KV_MARKER)}
local CREATE_MISSING_RUNTIME_TRIGGERS = {create_missing}
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

local function get_unit_by_name(name)
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

local function add_child(parent_uid, child_uid)
  if parent_uid == nil or child_uid == nil or EditorAPI.unit_add_child == nil then
    return false
  end
  local ok = pcall(function()
    return EditorAPI.unit_add_child(parent_uid, child_uid)
  end)
  return ok
end

local function create_runtime_trigger(item)
  if item.runtimeTrigger ~= true or CREATE_MISSING_RUNTIME_TRIGGERS ~= true then
    return nil
  end
  local parent_uid = get_unit_by_name(item.parentName)
  local ok, uid = pcall(function()
    return EditorAPI.create_obstacle(item.prefabId, math.Vector3(item.x, item.y, item.z), parent_uid or 0)
  end)
  if not ok then
    ok, uid = pcall(function()
      return EditorAPI.create_obstacle(item.prefabId, math.Vector3(item.x, item.y, item.z))
    end)
  end
  if ok and uid ~= nil then
    pcall(function() EditorAPI.set_unit_attr(uid, "name", item.name) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "position", math.Vector3(item.x, item.y, item.z)) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "scale", math.Vector3(item.sx, item.sy, item.sz)) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "model_alpha", 0) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "init_model_visible", false) end)
    add_child(parent_uid, uid)
    return uid
  end
  return nil
end

local function apply_custom_kv(uid, item)
  local mismatches = 0
  if uid == nil or item == nil or item.customKv == nil or EditorAPI.set_unit_kv == nil then
    return 1
  end
  for index = 1, #item.customKv do
    local kv = item.customKv[index]
    if kv ~= nil and kv.key ~= nil and kv.valueType ~= nil then
      local ok_set, set_err = pcall(function()
        EditorAPI.set_unit_kv(uid, kv.key, editor_kv_value_type(kv.valueType), kv.value)
      end)
      if not ok_set then
        mismatches = mismatches + 1
        emit("SET_FAIL:" .. item.name .. ":" .. tostring(kv.key) .. ":" .. tostring(set_err))
      end
      if EditorAPI.get_unit_kv ~= nil then
        local ok_get, actual = pcall(function() return EditorAPI.get_unit_kv(uid, kv.key) end)
        if not ok_get or actual == nil or tostring(actual) ~= tostring(kv.value) then
          mismatches = mismatches + 1
          emit(
            "MISMATCH:" .. item.name
            .. ":" .. tostring(kv.key)
            .. ":expected=" .. tostring(kv.value)
            .. ":actual=" .. tostring(actual)
          )
        end
      end
    end
  end
  return mismatches
end

local found = 0
local missing = 0
local created = 0
local applied = 0
local mismatched = 0
local role_counts = {{}}

for index = 1, #ITEMS do
  local item = ITEMS[index]
  local uid = get_unit_by_name(item.name)
  if uid == nil and item.legacyName ~= nil then
    uid = get_unit_by_name(item.legacyName)
    if uid ~= nil then
      pcall(function() EditorAPI.set_unit_attr(uid, "name", item.name) end)
    end
  end
  if uid == nil then
    uid = create_runtime_trigger(item)
    if uid ~= nil then
      created = created + 1
    end
  end
  if uid == nil then
    missing = missing + 1
    emit("MISSING:" .. item.name)
  else
    found = found + 1
    local item_mismatches = apply_custom_kv(uid, item)
    if item_mismatches == 0 then
      applied = applied + 1
    else
      mismatched = mismatched + 1
    end
    if item.customKv ~= nil then
      for kv_index = 1, #item.customKv do
        local kv = item.customKv[kv_index]
        if kv.key == "QRRole" then
          role_counts[tostring(kv.value)] = (role_counts[tostring(kv.value)] or 0) + 1
        end
      end
    end
  end
end

emit(
  "DONE:total=" .. tostring(#ITEMS)
  .. ":found=" .. tostring(found)
  .. ":created=" .. tostring(created)
  .. ":missing=" .. tostring(missing)
  .. ":applied=" .. tostring(applied)
  .. ":mismatched=" .. tostring(mismatched)
)
for role, count in pairs(role_counts) do
  emit("ROLE:" .. tostring(role) .. "=" .. tostring(count))
end
"""


def parse_batch_result(log_text: str, run_id: str) -> dict[str, Any]:
    prefix = f"{KV_MARKER}:{run_id}:"
    result: dict[str, Any] = {
        "total": 0,
        "found": 0,
        "created": 0,
        "missing": 0,
        "applied": 0,
        "mismatched": 0,
        "roles": {},
        "missing_names": [],
        "mismatches": [],
    }
    for line in log_text.splitlines():
        if prefix not in line:
            continue
        payload = line.split(prefix, 1)[1].strip().strip('"')
        if payload.startswith("DONE:"):
            for key in ("total", "found", "created", "missing", "applied", "mismatched"):
                match = re.search(rf"{key}=(\d+)", payload)
                if match:
                    result[key] = int(match.group(1))
        elif payload.startswith("ROLE:"):
            role_payload = payload.split("ROLE:", 1)[1]
            if "=" in role_payload:
                role, count = role_payload.rsplit("=", 1)
                result["roles"][role] = result["roles"].get(role, 0) + int(count)
        elif payload.startswith("MISSING:") and len(result["missing_names"]) < 20:
            result["missing_names"].append(payload.split("MISSING:", 1)[1])
        elif (payload.startswith("MISMATCH:") or payload.startswith("SET_FAIL:")) and len(result["mismatches"]) < 20:
            result["mismatches"].append(payload)
    return result


def merge_summary(target: dict[str, Any], batch: dict[str, Any]) -> None:
    for key in ("total", "found", "created", "missing", "applied", "mismatched"):
        target[key] += int(batch[key])
    for role, count in batch["roles"].items():
        target["roles"][role] = target["roles"].get(role, 0) + int(count)
    target["missing_names"].extend(batch["missing_names"])
    target["mismatches"].extend(batch["mismatches"])
    target["missing_names"] = target["missing_names"][:20]
    target["mismatches"] = target["mismatches"][:20]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Apply quick-runner runtime custom KV to editor scene units.")
    add_workspace_argument(parser)
    add_editor_transport_arguments(parser)
    parser.add_argument("--role", action="append", default=[], help="Only apply one QRRole. Can be passed multiple times.")
    parser.add_argument("--batch-size", type=int, default=40)
    parser.add_argument("--start-index", type=int, default=0, help="0-based selected item index to start from.")
    parser.add_argument("--limit", type=int, default=0, help="Maximum selected items to execute; 0 means all remaining.")
    parser.add_argument("--create-missing-runtime-triggers", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = args.workspace.resolve()
    roles = {str(role) for role in args.role}
    selected = select_items(build_plan(workspace), roles, args.create_missing_runtime_triggers)
    start_index = max(0, int(args.start_index))
    if start_index > len(selected):
        raise ValueError(f"--start-index 超出选择范围: {start_index} > {len(selected)}")
    run_items = selected[start_index:]
    if args.limit and args.limit > 0:
        run_items = run_items[: args.limit]

    if args.dry_run:
        dump_json(
            {
                "ok": True,
                "dry_run": True,
                "selected": len(selected),
                "run_items": len(run_items),
                "items": [plan_item_dict(item.item) for item in run_items],
            },
            compact=False,
        )
        return 0

    summary: dict[str, Any] = {
        "total": 0,
        "found": 0,
        "created": 0,
        "missing": 0,
        "applied": 0,
        "mismatched": 0,
        "roles": {},
        "missing_names": [],
        "mismatches": [],
    }
    batch_size = max(1, int(args.batch_size))
    batches = [run_items[index : index + batch_size] for index in range(0, len(run_items), batch_size)]
    for batch_index, batch in enumerate(batches, start=1):
        run_id = f"{int(time.time())}_{batch_index}"
        log_text = run_editor_lua_and_collect_logs(
            workspace,
            build_lua(batch, run_id, args.create_missing_runtime_triggers),
            mode=args.mode,
            backend_ws_url=args.backend_ws_url,
            timeout=args.timeout,
            progress=lambda msg: print(msg, file=sys.stderr),
            marker_prefixes=[KV_MARKER],
        )
        batch_result = parse_batch_result(log_text, run_id)
        merge_summary(summary, batch_result)
        print(json.dumps({"batch": batch_index, "batches": len(batches), "summary": batch_result}, ensure_ascii=False), file=sys.stderr)

    ok = summary["total"] == len(run_items) and summary["missing"] == 0 and summary["mismatched"] == 0
    dump_json(
        {
            "ok": ok,
            "selected": len(selected),
            "run_items": len(run_items),
            "start_index": start_index,
            "batches": len(batches),
            "summary": summary,
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
