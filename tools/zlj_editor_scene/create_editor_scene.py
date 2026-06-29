#!/usr/bin/env python3
"""Create the quick-runner Zulijian-style scene in the Eggitor editor.

The plan deliberately separates the birth module (module 0) from playable
levels (modules 1..10). Runtime TS should not create terrain in quick-runner.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any


WORKSPACE = Path(__file__).resolve().parents[2]
PLATFORM_ROOT = WORKSPACE.parent / "platform"
COMMON_ROOT = PLATFORM_ROOT / "skills" / "common"
if str(COMMON_ROOT) not in sys.path:
    sys.path.insert(0, str(COMMON_ROOT))

from eggitor_agent.cli import add_editor_transport_arguments, add_workspace_argument, dump_json, error_payload  # noqa: E402
from eggitor_agent.runner import run_editor_lua_and_collect_logs  # noqa: E402


MARKER = "QR_ZLJ_SCENE"
WALL_PREFAB_ID = 105205
ZLJ_FLOOR_PREFAB_ID = 1201010
FALL_DEATH_TRIGGER_PREFAB_ID = 3101010
FOURTH_COMPRESSOR_DEATH_TRIGGER_PREFAB_ID = 3101010
FOURTH_COMPRESSOR_DEATH_TRIGGER_OUTSET = 0.25
FOURTH_COMPRESSOR_DEATH_TRIGGER_LOCAL_Y = 4.0
FOURTH_COMPRESSOR_MOVE_SECONDS = 1.5
EIGHTH_MECHANISM_DEATH_TRIGGER_PREFAB_ID = 3101010
EIGHTH_MECHANISM_DEATH_TRIGGER_OUTSET = 0.2
ZLJ_FLOOR_MODEL_ID = 90004
ZLJ_FLOOR_WORLD_UNITS_PER_SCALE_X = 15.0
ZLJ_FLOOR_WORLD_UNITS_PER_SCALE_Z = 10.0
ZLJ_FLOOR_SCALE_Y = 1.0

BIRTH_FLOOR_CENTER_X = 919.0
BIRTH_EDITOR_SPAWN_Y = 5.0
RUNTIME_FLOOR_Z = -36.0
FLOOR_BASE_Y = 0.0
TILE_BASE_Y = 3.0
BIRTH_TILE_BASE_Y = 3.5
TILE_HEIGHT = 3.0
BASE_MIDDLE_LAYER_Y = 3.05
BASE_MIDDLE_LAYER_SY = 0.1
WALL_BASE_Y = 2.0
WALL_HEIGHT = 45.0
CEILING_BASE_Y = 46.5
CEILING_SY = 1.5
SIDE_WALL_THICKNESS = 2.0
SIDE_WALL_INSET = 0.5
WEST_WALL_OPENING_GAP_SZ = 19.0
FIRST_LEVEL_TERRAIN_BASE_Y = 3.5
FIRST_LEVEL_TERRAIN_HEIGHT = 3.0
HOLE_DEATH_TRIGGER_CENTER_Y = 4.375
HOLE_DEATH_TRIGGER_HEIGHT = 2.65
FOURTH_LEVEL_COMPRESSOR_START_Y = FIRST_LEVEL_TERRAIN_BASE_Y + FIRST_LEVEL_TERRAIN_HEIGHT + 8.0
EIGHTH_LEVEL_FIXED_HIGH_BAR_HEIGHT = 9.5
EIGHTH_LEVEL_MECHANISM_CENTER_RAISE_Y = 5.5
EIGHTH_LEVEL_MOVING_LONG_PLATE_EXTRA_RAISE_Y = -1.0
EIGHTH_LEVEL_SMALL_CROSSBAR_EXTRA_RAISE_Y = 0.75
FIFTH_LEVEL_MODULE_INDEX = 5
FIFTH_MIDDLE_LAYER_SY = 0.1
MIDDLE_LAYER_PAINT_COLOR = 0xFF0000
FIFTH_MIDDLE_CHANNEL_CENTER_Y = 5.0
FIFTH_MIDDLE_CHANNEL_SY = 3.0
FIFTH_MIDDLE_CHANNEL_TOP_Y = FIFTH_MIDDLE_CHANNEL_CENTER_Y + FIFTH_MIDDLE_CHANNEL_SY / 2
FIFTH_MIDDLE_CHANNEL_LAYER_TOP_DOWN_Y = 3.1
FIFTH_MIDDLE_CHANNEL_LAYER_TOP_UP_Y = FIFTH_MIDDLE_CHANNEL_TOP_Y
FIFTH_MIDDLE_CHANNEL_DOWN_Y = FIFTH_MIDDLE_CHANNEL_LAYER_TOP_DOWN_Y - FIFTH_MIDDLE_LAYER_SY / 2
FIFTH_MIDDLE_CHANNEL_UP_Y = FIFTH_MIDDLE_CHANNEL_LAYER_TOP_UP_Y - FIFTH_MIDDLE_LAYER_SY / 2
FIFTH_MIDDLE_GAP_DOWN_Y = FIFTH_MIDDLE_CHANNEL_DOWN_Y
FIFTH_MIDDLE_GAP_UP_Y = FIFTH_MIDDLE_CHANNEL_UP_Y

FIFTH_MIDDLE_LAYER_SPECS = [
    {"name": "夹层A", "startX": 0.0, "startZ": 0.0, "sx": 16.0, "sz": 31.25},
    {"name": "夹层B", "startX": 0.0, "startZ": 68.75, "sx": 16.0, "sz": 31.25},
    {"name": "夹层C_中间通道连接", "startX": 16.0, "startZ": 0.0, "sx": 128.0, "sz": 100.0, "channel": True},
    {"name": "夹层D", "startX": 144.0, "startZ": 0.0, "sx": 16.0, "sz": 12.5},
    {"name": "夹层E", "startX": 144.0, "startZ": 87.5, "sx": 16.0, "sz": 12.5},
]

THIRD_LEVEL_BLUE_PLATFORM_COLOR = 0x0066FF
THIRD_LEVEL_VANISH_TRIGGER_PREFAB_ID = 3101010
THIRD_LEVEL_VANISH_TRIGGER_EXTRA_HEIGHT = 2.5
THIRD_LEVEL_BLUE_PLATFORM_NAMES = {
    "dxf_840_24x17_1875",
    "dxf_85C_24x17_1875",
    "dxf_860_24x17_1875",
    "dxf_864_24x17_1875",
    "dxf_844_24x17_1875",
    "dxf_858_24x17_1875",
    "dxf_86C_24x17_1875",
    "dxf_868_24x17_1875",
    "dxf_848_24x17_1875",
    "dxf_84C_24x17_1875",
    "dxf_850_24x17_1875",
    "dxf_854_24x17_1875",
}
NINTH_LEVEL_VANISHING_PLATFORM_NAMES = {
    "dxf_760_50x20",
    "dxf_75C_50x20",
}

LEVEL_FRAMES = {index: {"sx": 160.0, "sz": 100.0} for index in range(0, 11)}


@dataclass
class SceneItem:
    section: str
    module: int
    name: str
    prefab_id: int
    x: float
    y: float
    z: float
    sx: float
    sy: float
    sz: float
    model_id: int | None = None
    paint_color: int | None = None
    runtime_placeholder: bool = False
    runtime_trigger: bool = False
    custom_kv: dict[str, Any] | None = None
    parent_name_override: str | None = None

    @property
    def full_name(self) -> str:
        return f"QR_{self.name}"

    @property
    def parent_name(self) -> str:
        if self.parent_name_override is not None:
            return self.parent_name_override
        return root_name(self.module)

    @property
    def legacy_full_name(self) -> str:
        legacy = legacy_module_name(self.module, self.name.split("_", 1)[1] if "_" in self.name else self.name)
        return f"QR_{legacy}"


def module_label(module: int) -> str:
    return "出生地" if module == 0 else f"第{module:02d}关"


def legacy_module_label(module: int) -> str:
    return "出生地" if module == 0 else f"第{module}关"


def module_name(module: int, name: str) -> str:
    return f"{module_label(module)}_{name}"


def legacy_module_name(module: int, name: str) -> str:
    return f"{legacy_module_label(module)}_{name}"


def root_name(module: int) -> str:
    return f"QR_{module_label(module)}_ROOT"


def module_center_x(module: int) -> float:
    x = BIRTH_FLOOR_CENTER_X
    previous_sx = LEVEL_FRAMES[0]["sx"]
    for index in range(1, module + 1):
        current_sx = LEVEL_FRAMES[index]["sx"]
        x -= previous_sx / 2 + current_sx / 2
        previous_sx = current_sx
    return x


def floor_editor_scale(frame: dict[str, float]) -> tuple[float, float, float]:
    """Convert desired floor world footprint to model 90004 editor scale."""
    return (
        frame["sx"] / ZLJ_FLOOR_WORLD_UNITS_PER_SCALE_X,
        ZLJ_FLOOR_SCALE_Y,
        frame["sz"] / ZLJ_FLOOR_WORLD_UNITS_PER_SCALE_Z,
    )


def add_side_segment(items: list[dict[str, Any]], name: str, side: str, x: float, start_z: float, end_z: float) -> None:
    sz = end_z - start_z
    if sz <= 0:
        return
    items.append({"name": name, "side": side, "x": x, "z": start_z + sz / 2, "sx": SIDE_WALL_THICKNESS, "sz": sz})


def walls_for_module(module: int) -> list[dict[str, Any]]:
    frame = LEVEL_FRAMES[module]
    center_x = module_center_x(module)
    center_z = RUNTIME_FLOOR_Z
    min_x = center_x - frame["sx"] / 2
    max_x = center_x + frame["sx"] / 2
    min_z = center_z - frame["sz"] / 2
    max_z = center_z + frame["sz"] / 2
    wall_min_z = min_z + SIDE_WALL_INSET
    wall_max_z = max_z - SIDE_WALL_INSET
    walls: list[dict[str, Any]] = [
        {"name": "北墙", "side": "north", "x": center_x, "z": wall_min_z, "sx": frame["sx"] - SIDE_WALL_INSET * 2, "sz": SIDE_WALL_THICKNESS},
        {"name": "南墙", "side": "south", "x": center_x, "z": wall_max_z, "sx": frame["sx"] - SIDE_WALL_INSET * 2, "sz": SIDE_WALL_THICKNESS},
    ]

    def add_side_with_opening(prefix: str, side: str, x: float, start_z: float, end_z: float) -> None:
        opening_min_z = center_z - WEST_WALL_OPENING_GAP_SZ / 2
        opening_max_z = center_z + WEST_WALL_OPENING_GAP_SZ / 2
        add_side_segment(walls, f"{prefix}上段", side, x, start_z, min(opening_min_z, end_z))
        add_side_segment(walls, f"{prefix}下段", side, x, max(opening_max_z, start_z), end_z)

    if module == 0:
        add_side_segment(walls, "东墙", "east", max_x - SIDE_WALL_INSET, wall_min_z, wall_max_z)
    else:
        previous_frame = LEVEL_FRAMES[module - 1]
        previous_min_z = center_z - previous_frame["sz"] / 2 + SIDE_WALL_INSET
        previous_max_z = center_z + previous_frame["sz"] / 2 - SIDE_WALL_INSET
        add_side_segment(walls, "东墙外露上段", "east", max_x - SIDE_WALL_INSET, wall_min_z, min(previous_min_z, wall_max_z))
        add_side_segment(walls, "东墙外露下段", "east", max_x - SIDE_WALL_INSET, max(previous_max_z, wall_min_z), wall_max_z)

    if module == 10:
        add_side_segment(walls, "西墙封口", "west", min_x + SIDE_WALL_INSET, wall_min_z, wall_max_z)
    else:
        add_side_with_opening("西墙", "west", min_x + SIDE_WALL_INSET, wall_min_z, wall_max_z)
    return walls


REQUIRED_TERRAIN_FIELDS = {"name", "startX", "startZ", "sx", "sy", "sz"}
ALLOWED_TERRAIN_FIELDS = REQUIRED_TERRAIN_FIELDS | {"baseY", "prefabId", "role"}


def parse_level_data(path: Path) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    terrain = raw.get("terrain")
    if not isinstance(terrain, list):
        raise TypeError(f"{path}: terrain must be a list")

    out: list[dict[str, Any]] = []
    for index, spec in enumerate(terrain, start=1):
        if not isinstance(spec, dict):
            raise TypeError(f"{path}: terrain[{index}] must be an object")
        missing = sorted(REQUIRED_TERRAIN_FIELDS - set(spec))
        if missing:
            raise ValueError(f"{path}: terrain[{index}] missing {', '.join(missing)}")
        extra = sorted(set(spec) - ALLOWED_TERRAIN_FIELDS)
        if extra:
            raise ValueError(f"{path}: terrain[{index}] has unknown fields {', '.join(extra)}")
        out.append(dict(spec))
    return out


def load_fall_death_zones(workspace: Path) -> dict[int, list[dict[str, Any]]]:
    path = workspace / "data" / "zlj" / "fall_death_zones.json"
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    zones = raw.get("zones")
    if not isinstance(zones, list):
        raise TypeError(f"{path}: zones must be a list")

    out: dict[int, list[dict[str, Any]]] = {}
    required = {"module", "name", "startX", "startZ", "sx", "sz"}
    for index, zone in enumerate(zones, start=1):
        if not isinstance(zone, dict):
            raise TypeError(f"{path}: zones[{index}] must be an object")
        missing = sorted(required - set(zone))
        if missing:
            raise ValueError(f"{path}: zones[{index}] missing {', '.join(missing)}")
        module = int(zone["module"])
        out.setdefault(module, []).append(zone)
    return out


def load_runtime_scene_kv(workspace: Path) -> dict[tuple[int, str], dict[str, Any]]:
    path = workspace / "data" / "zlj" / "runtime_scene_bindings.json"
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    bindings = raw.get("bindings")
    if not isinstance(bindings, list):
        raise TypeError(f"{path}: bindings must be a list")

    out: dict[tuple[int, str], dict[str, Any]] = {}
    required = {"module", "component", "role"}
    allowed = required | {"moveZ", "moving"}
    for index, binding in enumerate(bindings, start=1):
        if not isinstance(binding, dict):
            raise TypeError(f"{path}: bindings[{index}] must be an object")
        missing = sorted(required - set(binding))
        if missing:
            raise ValueError(f"{path}: bindings[{index}] missing {', '.join(missing)}")
        extra = sorted(set(binding) - allowed)
        if extra:
            raise ValueError(f"{path}: bindings[{index}] has unknown fields {', '.join(extra)}")
        module = int(binding["module"])
        component = str(binding["component"])
        kv: dict[str, Any] = {
            "QRRole": str(binding["role"]),
            "QRModule": module,
            "QRComponent": component,
            "QRRuntimeName": module_name(module, component),
        }
        if "moveZ" in binding:
            kv["QRMoveZ"] = float(binding["moveZ"])
        if "moving" in binding:
            kv["QRMoving"] = bool(binding["moving"])
        out[(module, component)] = kv
    return out


def load_level_specs(workspace: Path, module: int) -> list[dict[str, Any]]:
    data_path = workspace / "data" / "zlj" / "levels" / f"level_{module:02d}.json"
    if not data_path.exists():
        raise FileNotFoundError(f"{data_path}: missing level geometry data")
    return parse_level_data(data_path)


def terrain_y(module: int, piece: dict[str, Any]) -> float:
    if piece.get("role") == "fourth_compressor":
        return FOURTH_LEVEL_COMPRESSOR_START_Y
    y = float(piece.get("baseY", FIRST_LEVEL_TERRAIN_BASE_Y))
    if module != 8:
        return y
    sx = float(piece["sx"])
    sy = float(piece["sy"])
    sz = float(piece["sz"])
    if sx == 112 and sy == EIGHTH_LEVEL_FIXED_HIGH_BAR_HEIGHT and sz == 4:
        return y + FIRST_LEVEL_TERRAIN_HEIGHT
    if sx == 0.5 and sz == 4:
        return y + EIGHTH_LEVEL_MECHANISM_CENTER_RAISE_Y + EIGHTH_LEVEL_SMALL_CROSSBAR_EXTRA_RAISE_Y
    if (sx == 35 or sx == 27.5) and sy == 5 and sz == 4:
        return y + EIGHTH_LEVEL_MECHANISM_CENTER_RAISE_Y + EIGHTH_LEVEL_MOVING_LONG_PLATE_EXTRA_RAISE_Y
    return y


def fifth_middle_layer_y(spec: dict[str, Any]) -> float:
    return FIFTH_MIDDLE_CHANNEL_DOWN_Y if spec.get("channel") is True else FIFTH_MIDDLE_GAP_DOWN_Y


def add_fifth_middle_layers(items: list[SceneItem], module: int, module_min_x: float, module_min_z: float) -> None:
    for spec in FIFTH_MIDDLE_LAYER_SPECS:
        x = module_min_x + float(spec["startX"]) + float(spec["sx"]) / 2
        z = module_min_z + float(spec["startZ"]) + float(spec["sz"]) / 2
        items.append(
            SceneItem(
                "level",
                module,
                module_name(module, str(spec["name"])),
                WALL_PREFAB_ID,
                x,
                fifth_middle_layer_y(spec),
                z,
                float(spec["sx"]),
                FIFTH_MIDDLE_LAYER_SY,
                float(spec["sz"]),
                paint_color=MIDDLE_LAYER_PAINT_COLOR,
            )
        )


def add_base_middle_layer(items: list[SceneItem], section: str, module: int, center_x: float, frame: dict[str, float]) -> None:
    items.append(
        SceneItem(
            section,
            module,
            module_name(module, "基础夹层"),
            WALL_PREFAB_ID,
            center_x,
            BASE_MIDDLE_LAYER_Y,
            RUNTIME_FLOOR_Z,
            frame["sx"],
            BASE_MIDDLE_LAYER_SY,
            frame["sz"],
            paint_color=MIDDLE_LAYER_PAINT_COLOR,
        )
    )


def third_level_vanishing_platform_kv(module: int, piece_name: str) -> dict[str, Any]:
    return {
        "QRRole": "third_vanishing_platform",
        "QRModule": module,
        "QRComponent": piece_name,
        "QRRuntimeName": module_name(module, piece_name),
        "QRVanish": True,
        "QRVanishMode": "fade",
    }


def third_level_vanishing_trigger_kv(module: int, piece_name: str, trigger_name: str) -> dict[str, Any]:
    return {
        "QRRole": "third_vanishing_trigger",
        "QRModule": module,
        "QRComponent": trigger_name,
        "QRRuntimeName": module_name(module, trigger_name),
        "QRTargetComponent": piece_name,
        "QRTargetRuntimeName": module_name(module, piece_name),
        "QRTriggerAction": "fade_on_player_touch",
    }


def ninth_level_vanishing_platform_kv(module: int, piece_name: str) -> dict[str, Any]:
    return {
        "QRRole": "ninth_vanishing_platform",
        "QRModule": module,
        "QRComponent": piece_name,
        "QRRuntimeName": module_name(module, piece_name),
        "QRVanish": True,
        "QRVanishMode": "fade",
    }


def ninth_level_vanishing_trigger_kv(module: int, piece_name: str, trigger_name: str) -> dict[str, Any]:
    return {
        "QRRole": "ninth_vanishing_trigger",
        "QRModule": module,
        "QRComponent": trigger_name,
        "QRRuntimeName": module_name(module, trigger_name),
        "QRTargetComponent": piece_name,
        "QRTargetRuntimeName": module_name(module, piece_name),
        "QRTriggerAction": "fade_on_player_touch",
    }


def fourth_level_compressor_kv(module: int, piece_name: str) -> dict[str, Any]:
    return {
        "QRRole": "fourth_compressor",
        "QRModule": module,
        "QRComponent": piece_name,
        "QRRuntimeName": module_name(module, piece_name),
        "QRMoving": True,
        "QRTouchDeath": True,
        "QRMoveSeconds": FOURTH_COMPRESSOR_MOVE_SECONDS,
    }


def fourth_level_compressor_trigger_kv(module: int, piece_name: str, trigger_name: str) -> dict[str, Any]:
    return {
        "QRRole": "fourth_compressor_death_trigger",
        "QRModule": module,
        "QRComponent": trigger_name,
        "QRRuntimeName": module_name(module, trigger_name),
        "QRTargetComponent": piece_name,
        "QRTargetRuntimeName": module_name(module, piece_name),
        "QRMoving": True,
        "QRTouchDeath": True,
        "QRMoveSeconds": FOURTH_COMPRESSOR_MOVE_SECONDS,
    }


def is_eighth_level_moving_mechanism_piece(module: int, piece: dict[str, Any]) -> bool:
    if module != 8:
        return False
    sx = float(piece["sx"])
    sy = float(piece["sy"])
    sz = float(piece["sz"])
    return (sx == 0.5 and sz == 4) or ((sx == 35 or sx == 27.5) and sy == 5 and sz == 4)


def eighth_level_moving_mechanism_ground_surface_y(piece: dict[str, Any]) -> float:
    return float(piece.get("baseY", FIRST_LEVEL_TERRAIN_BASE_Y))


def eighth_level_moving_mechanism_clearance_y(piece: dict[str, Any], center_y: float) -> float:
    ground_surface_y = eighth_level_moving_mechanism_ground_surface_y(piece)
    part_bottom_y = center_y - float(piece["sy"]) / 2
    return part_bottom_y - ground_surface_y


def eighth_level_moving_mechanism_trigger_local_y(piece: dict[str, Any], center_y: float, trigger_sy: float) -> float:
    ground_surface_y = eighth_level_moving_mechanism_ground_surface_y(piece)
    clearance_y = eighth_level_moving_mechanism_clearance_y(piece, center_y)
    trigger_bottom_y = ground_surface_y + clearance_y
    trigger_center_y = trigger_bottom_y + trigger_sy / 2
    return trigger_center_y - center_y


def eighth_level_moving_mechanism_trigger_kv(
    module: int,
    piece_name: str,
    trigger_name: str,
    ground_surface_y: float,
    clearance_y: float,
    trigger_bottom_y: float,
) -> dict[str, Any]:
    return {
        "QRRole": "eighth_moving_death_trigger",
        "QRModule": module,
        "QRComponent": trigger_name,
        "QRRuntimeName": module_name(module, trigger_name),
        "QRTargetComponent": piece_name,
        "QRTargetRuntimeName": module_name(module, piece_name),
        "QRMoving": True,
        "QRTouchDeath": True,
        "QRGroundSurfaceY": ground_surface_y,
        "QRGroundClearanceY": clearance_y,
        "QRTriggerBottomY": trigger_bottom_y,
    }


def build_plan(workspace: Path) -> list[SceneItem]:
    items: list[SceneItem] = []
    fall_death_zones_by_module = load_fall_death_zones(workspace)
    runtime_kv_by_component = load_runtime_scene_kv(workspace)
    for module in range(0, 11):
        frame = LEVEL_FRAMES[module]
        center_x = module_center_x(module)
        section = "birth" if module == 0 else "level"
        floor_sx, floor_sy, floor_sz = floor_editor_scale(frame)
        items.append(
            SceneItem(
                section,
                module,
                module_name(module, "地板"),
                ZLJ_FLOOR_PREFAB_ID,
                center_x,
                FLOOR_BASE_Y,
                RUNTIME_FLOOR_Z,
                floor_sx,
                floor_sy,
                floor_sz,
                ZLJ_FLOOR_MODEL_ID,
            )
        )
        items.append(SceneItem(section, module, module_name(module, "天花板"), WALL_PREFAB_ID, center_x, CEILING_BASE_Y, RUNTIME_FLOOR_Z, frame["sx"], CEILING_SY, frame["sz"]))
        for wall in walls_for_module(module):
            items.append(SceneItem(section, module, module_name(module, str(wall["name"])), WALL_PREFAB_ID, float(wall["x"]), WALL_BASE_Y, float(wall["z"]), float(wall["sx"]), WALL_HEIGHT, float(wall["sz"])))

        module_min_x = center_x - frame["sx"] / 2
        module_min_z = RUNTIME_FLOOR_Z - frame["sz"] / 2
        add_base_middle_layer(items, section, module, center_x, frame)
        if module == 0:
            items.append(SceneItem("birth", module, module_name(module, "出生地砖"), WALL_PREFAB_ID, center_x, BIRTH_TILE_BASE_Y, RUNTIME_FLOOR_Z, frame["sx"], TILE_HEIGHT, frame["sz"]))
            continue

        if module == FIFTH_LEVEL_MODULE_INDEX:
            add_fifth_middle_layers(items, module, module_min_x, module_min_z)

        for piece in load_level_specs(workspace, module):
            x = module_min_x + float(piece["startX"]) + float(piece["sx"]) / 2
            z = module_min_z + float(piece["startZ"]) + float(piece["sz"]) / 2
            y = terrain_y(module, piece)
            prefab_id = int(piece.get("prefabId", WALL_PREFAB_ID))
            piece_name = str(piece["name"])
            is_third_vanishing_platform = module == 3 and piece_name in THIRD_LEVEL_BLUE_PLATFORM_NAMES
            is_ninth_third_api_vanishing_platform = module == 9 and piece_name in NINTH_LEVEL_VANISHING_PLATFORM_NAMES
            is_fourth_compressor = module == 4 and piece.get("role") == "fourth_compressor"
            is_eighth_moving_mechanism = is_eighth_level_moving_mechanism_piece(module, piece)
            custom_kv = (
                third_level_vanishing_platform_kv(module, piece_name)
                if is_third_vanishing_platform
                else ninth_level_vanishing_platform_kv(module, piece_name)
                if is_ninth_third_api_vanishing_platform
                else fourth_level_compressor_kv(module, piece_name)
                if is_fourth_compressor
                else runtime_kv_by_component.get((module, piece_name))
            )
            items.append(
                SceneItem(
                    "level",
                    module,
                    module_name(module, piece_name),
                    prefab_id,
                    x,
                    y,
                    z,
                    float(piece["sx"]),
                    float(piece["sy"]),
                    float(piece["sz"]),
                    paint_color=THIRD_LEVEL_BLUE_PLATFORM_COLOR
                    if is_third_vanishing_platform or is_ninth_third_api_vanishing_platform
                    else None,
                    custom_kv=dict(custom_kv) if custom_kv is not None else None,
                )
            )
            if is_third_vanishing_platform or is_ninth_third_api_vanishing_platform:
                trigger_name = f"{piece_name}_渐隐触发区"
                trigger_sy = float(piece["sy"]) + THIRD_LEVEL_VANISH_TRIGGER_EXTRA_HEIGHT
                items.append(
                    SceneItem(
                        "level",
                        module,
                        module_name(module, trigger_name),
                        THIRD_LEVEL_VANISH_TRIGGER_PREFAB_ID,
                        0,
                        THIRD_LEVEL_VANISH_TRIGGER_EXTRA_HEIGHT / 2,
                        0,
                        float(piece["sx"]),
                        trigger_sy,
                        float(piece["sz"]),
                        runtime_trigger=True,
                        custom_kv=third_level_vanishing_trigger_kv(module, piece_name, trigger_name)
                        if is_third_vanishing_platform
                        else ninth_level_vanishing_trigger_kv(module, piece_name, trigger_name),
                        parent_name_override=f"QR_{module_name(module, piece_name)}",
                    )
                )
            if is_fourth_compressor:
                trigger_name = f"{piece_name}_压板死亡触发区"
                items.append(
                    SceneItem(
                        "level",
                        module,
                        module_name(module, trigger_name),
                        FOURTH_COMPRESSOR_DEATH_TRIGGER_PREFAB_ID,
                        0,
                        FOURTH_COMPRESSOR_DEATH_TRIGGER_LOCAL_Y,
                        0,
                        float(piece["sx"]) + FOURTH_COMPRESSOR_DEATH_TRIGGER_OUTSET * 2,
                        float(piece["sy"]) + FOURTH_COMPRESSOR_DEATH_TRIGGER_OUTSET * 2,
                        float(piece["sz"]) + FOURTH_COMPRESSOR_DEATH_TRIGGER_OUTSET * 2,
                        runtime_trigger=True,
                        custom_kv=fourth_level_compressor_trigger_kv(module, piece_name, trigger_name),
                        parent_name_override=f"QR_{module_name(module, piece_name)}",
                    )
                )
            if is_eighth_moving_mechanism:
                trigger_name = f"{piece_name}_移动死亡触发区"
                trigger_sx = float(piece["sx"]) + EIGHTH_MECHANISM_DEATH_TRIGGER_OUTSET * 2
                trigger_sy = float(piece["sy"]) + EIGHTH_MECHANISM_DEATH_TRIGGER_OUTSET * 2
                trigger_sz = float(piece["sz"]) + EIGHTH_MECHANISM_DEATH_TRIGGER_OUTSET * 2
                ground_surface_y = eighth_level_moving_mechanism_ground_surface_y(piece)
                clearance_y = eighth_level_moving_mechanism_clearance_y(piece, y)
                trigger_bottom_y = ground_surface_y + clearance_y
                trigger_local_y = eighth_level_moving_mechanism_trigger_local_y(piece, y, trigger_sy)
                items.append(
                    SceneItem(
                        "level",
                        module,
                        module_name(module, trigger_name),
                        EIGHTH_MECHANISM_DEATH_TRIGGER_PREFAB_ID,
                        0,
                        trigger_local_y,
                        0,
                        trigger_sx,
                        trigger_sy,
                        trigger_sz,
                        runtime_trigger=True,
                        custom_kv=eighth_level_moving_mechanism_trigger_kv(
                            module,
                            piece_name,
                            trigger_name,
                            ground_surface_y,
                            clearance_y,
                            trigger_bottom_y,
                        ),
                        parent_name_override=f"QR_{module_name(module, piece_name)}",
                    )
                )
        for zone in fall_death_zones_by_module.get(module, []):
            zone_name = f"掉坑死亡_{zone['name']}"
            x = module_min_x + float(zone["startX"]) + float(zone["sx"]) / 2
            z = module_min_z + float(zone["startZ"]) + float(zone["sz"]) / 2
            items.append(
                SceneItem(
                    "level",
                    module,
                    module_name(module, zone_name),
                    FALL_DEATH_TRIGGER_PREFAB_ID,
                    x,
                    HOLE_DEATH_TRIGGER_CENTER_Y,
                    z,
                    float(zone["sx"]),
                    HOLE_DEATH_TRIGGER_HEIGHT,
                    float(zone["sz"]),
                    runtime_trigger=True,
                    custom_kv={
                        "QRRole": "fall_death",
                        "QRModule": module,
                        "QRComponent": zone_name,
                        "QRRuntimeName": module_name(module, zone_name),
                    },
                )
            )
    return items


def lua_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def lua_kv_value(value: Any) -> tuple[str, str]:
    if isinstance(value, bool):
        return "Bool", "true" if value else "false"
    if isinstance(value, int) and not isinstance(value, bool):
        return "Int", str(value)
    if isinstance(value, float):
        return "Fixed", f"{value:.10f}".rstrip("0").rstrip(".")
    # EditorAPI.set_unit_kv accepts the editor type name as a string in local-agent mode.
    # The editor Lua environment may not expose Enums.ValueType, so keep "Str" explicit.
    return "Str", lua_string(str(value))


def lua_custom_kv(custom_kv: dict[str, Any] | None) -> str:
    if not custom_kv:
        return "{}"
    entries: list[str] = []
    for key in sorted(custom_kv):
        value_type, value = lua_kv_value(custom_kv[key])
        entries.append(f"{{key={lua_string(key)}, valueType={lua_string(value_type)}, value={value}}}")
    return "{" + ", ".join(entries) + "}"


def lua_item(item: SceneItem) -> str:
    model_id = "nil" if item.model_id is None else str(item.model_id)
    paint_color = "nil" if item.paint_color is None else str(item.paint_color)
    runtime_placeholder = "true" if item.runtime_placeholder else "false"
    runtime_trigger = "true" if item.runtime_trigger else "false"
    return (
        "{"
        f"name={lua_string(item.full_name)}, legacyName={lua_string(item.legacy_full_name)}, parentName={lua_string(item.parent_name)}, "
        f"section={lua_string(item.section)}, module={item.module}, prefabId={item.prefab_id}, "
        f"x={item.x:.6f}, y={item.y:.6f}, z={item.z:.6f}, sx={item.sx:.6f}, sy={item.sy:.6f}, sz={item.sz:.6f}, "
        f"modelId={model_id}, paintColor={paint_color}, runtimePlaceholder={runtime_placeholder}, runtimeTrigger={runtime_trigger}, "
        f"customKv={lua_custom_kv(item.custom_kv)}"
        "}"
    )


def lua_roots() -> str:
    roots = [
        "{name='QR_地图_ROOT', parentName=nil, x=0, y=0, z=0}",
        "{name='QR_出生地_ROOT', parentName='QR_地图_ROOT', x=0, y=0, z=0}",
    ]
    for module in range(1, 11):
        roots.append(f"{{name={lua_string(root_name(module))}, parentName='QR_地图_ROOT', x=0, y=0, z=0}}")
    return ",\n".join(roots)


def build_lua(items: list[SceneItem], run_id: str) -> str:
    body = ",\n".join(lua_item(item) for item in items)
    roots = lua_roots()
    return f"""
local RUN_ID = {lua_string(run_id)}
local MARKER = {lua_string(MARKER)}
local ROOT_PREFAB_ID = {WALL_PREFAB_ID}
local ROOTS = {{
{roots}
}}
local ITEMS = {{
{body}
}}

local function emit(msg)
  EditorAPI.log(MARKER .. ":" .. RUN_ID .. ":" .. msg)
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

local created = 0
local replaced = 0
local skipped = 0
local failed = 0
local roots_created = 0
local roots_skipped = 0
local attached = 0
local spawn_moved = 0

local function set_root_attrs(uid, item)
  pcall(function() EditorAPI.set_unit_attr(uid, "name", item.name) end)
  pcall(function() EditorAPI.set_unit_attr(uid, "position", math.Vector3(item.x, item.y, item.z)) end)
  pcall(function() EditorAPI.set_unit_attr(uid, "scale", math.Vector3(1, 1, 1)) end)
  pcall(function() EditorAPI.set_unit_attr(uid, "model_alpha", 0) end)
  pcall(function() EditorAPI.set_unit_attr(uid, "physic_enable", false) end)
end

local function add_child(parent_uid, child_uid)
  if parent_uid == nil or child_uid == nil then
    return false
  end
  if EditorAPI.unit_add_child == nil then
    return false
  end
  local ok = pcall(function()
    return EditorAPI.unit_add_child(parent_uid, child_uid)
  end)
  return ok
end

local function apply_item_appearance(uid, item)
  if uid == nil or item == nil then
    return
  end
  if item.runtimeTrigger == true then
    pcall(function() EditorAPI.set_unit_attr(uid, "model_alpha", 0) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "init_model_visible", false) end)
    return
  end
  if item.paintColor ~= nil then
    pcall(function() EditorAPI.set_unit_attr(uid, "paint_area1", item.paintColor) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "paint_area2", item.paintColor) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "paint_area3", item.paintColor) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "paint_area4", item.paintColor) end)
  end
  if item.runtimePlaceholder == true then
    pcall(function() EditorAPI.set_unit_attr(uid, "model_alpha", 0) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "init_model_visible", false) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "physic_enable", false) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "collision_enabled", false) end)
  else
    pcall(function() EditorAPI.set_unit_attr(uid, "model_alpha", 1) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "init_model_visible", true) end)
    pcall(function() EditorAPI.set_unit_attr(uid, "physic_enable", true) end)
  end
end

local function editor_kv_value_type(type_name)
  if Enums ~= nil and Enums.ValueType ~= nil and Enums.ValueType[type_name] ~= nil then
    return Enums.ValueType[type_name]
  end
  return type_name
end

local function apply_item_custom_kv(uid, item)
  if uid == nil or item == nil or item.customKv == nil or EditorAPI.set_unit_kv == nil then
    return
  end
  for index = 1, #item.customKv do
    local kv = item.customKv[index]
    if kv ~= nil and kv.key ~= nil and kv.valueType ~= nil then
      pcall(function()
        EditorAPI.set_unit_kv(uid, kv.key, editor_kv_value_type(kv.valueType), kv.value)
      end)
    end
  end
end

local function ensure_root(item)
  local uid = existing[item.name]
  if uid ~= nil then
    roots_skipped = roots_skipped + 1
    return uid
  end
  local parent_uid = nil
  if item.parentName ~= nil then
    parent_uid = existing[item.parentName]
  end
  local ok, created_uid = pcall(function()
    return EditorAPI.create_obstacle(ROOT_PREFAB_ID, math.Vector3(item.x, item.y, item.z), parent_uid or 0)
  end)
  if not ok then
    ok, created_uid = pcall(function()
      return EditorAPI.create_obstacle(ROOT_PREFAB_ID, math.Vector3(item.x, item.y, item.z))
    end)
  end
  if ok and created_uid ~= nil then
    set_root_attrs(created_uid, item)
    existing[item.name] = created_uid
    if parent_uid ~= nil then
      attached = attached + 1
    end
    roots_created = roots_created + 1
    return created_uid
  end
  failed = failed + 1
  emit("ROOT_FAIL:" .. tostring(created_uid) .. ":" .. item.name)
  return nil
end

local function set_builtin_spawn_point(uid, label)
  if uid == nil then
    return
  end
  local ok = pcall(function()
    EditorAPI.set_unit_attr(uid, "position", math.Vector3({BIRTH_FLOOR_CENTER_X:.6f}, {BIRTH_EDITOR_SPAWN_Y:.6f}, {RUNTIME_FLOOR_Z:.6f}))
  end)
  if ok then
    spawn_moved = spawn_moved + 1
    emit("SPAWN_MOVED:" .. label .. ":uid=" .. tostring(uid))
  else
    emit("SPAWN_MOVE_FAIL:" .. label .. ":uid=" .. tostring(uid))
  end
end

for index = 1, #ROOTS do
  local root = ROOTS[index]
  local uid = ensure_root(root)
  if uid ~= nil and root.parentName ~= nil then
    local parent_uid = existing[root.parentName]
    if add_child(parent_uid, uid) then
      attached = attached + 1
    end
    pcall(function() EditorAPI.set_unit_attr(uid, "position", math.Vector3(root.x, root.y, root.z)) end)
  end
end

for index = 1, #ITEMS do
  local item = ITEMS[index]
  local uid = existing[item.name]
  if uid == nil and item.legacyName ~= nil and existing[item.legacyName] ~= nil then
    uid = existing[item.legacyName]
    pcall(function() EditorAPI.set_unit_attr(uid, "name", item.name) end)
    existing[item.name] = uid
  end

  if uid ~= nil and item.prefabId == {ZLJ_FLOOR_PREFAB_ID} then
    local ok_eid, unit_eid = pcall(function() return EditorAPI.get_unit_attr(uid, "unit_eid") end)
    if ok_eid and unit_eid ~= nil and tostring(unit_eid) ~= tostring(item.prefabId) then
      local ok_destroy = pcall(function() return EditorAPI.destroy_obstacle(uid) end)
      if ok_destroy then
        existing[item.name] = nil
        uid = nil
        replaced = replaced + 1
      else
        emit("REPLACE_FAIL:" .. tostring(uid) .. ":" .. item.name .. ":unit_eid=" .. tostring(unit_eid) .. ":target=" .. tostring(item.prefabId))
      end
    end
  end

    if uid ~= nil then
      skipped = skipped + 1
      local parent_uid = existing[item.parentName]
      if add_child(parent_uid, uid) then
        attached = attached + 1
      end
      pcall(function() EditorAPI.set_unit_attr(uid, "position", math.Vector3(item.x, item.y, item.z)) end)
      pcall(function() EditorAPI.set_unit_attr(uid, "scale", math.Vector3(item.sx, item.sy, item.sz)) end)
      if item.modelId ~= nil then
        pcall(function() EditorAPI.set_unit_attr(uid, "model", item.modelId) end)
        pcall(function() EditorAPI.set_unit_attr(uid, "model_id", item.modelId) end)
      end
      apply_item_appearance(uid, item)
      apply_item_custom_kv(uid, item)
    else
    local pos = math.Vector3(item.x, item.y, item.z)
    local parent_uid = existing[item.parentName]
    local ok, uid = pcall(function()
      return EditorAPI.create_obstacle(item.prefabId, pos, parent_uid or 0)
    end)
    if not ok then
      ok, uid = pcall(function()
        return EditorAPI.create_obstacle(item.prefabId, pos)
      end)
    end
    if ok and uid ~= nil then
      pcall(function() EditorAPI.set_unit_attr(uid, "name", item.name) end)
      pcall(function() EditorAPI.set_unit_attr(uid, "position", pos) end)
      pcall(function() EditorAPI.set_unit_attr(uid, "scale", math.Vector3(item.sx, item.sy, item.sz)) end)
      if item.modelId ~= nil then
        pcall(function() EditorAPI.set_unit_attr(uid, "model", item.modelId) end)
        pcall(function() EditorAPI.set_unit_attr(uid, "model_id", item.modelId) end)
      end
      apply_item_appearance(uid, item)
      apply_item_custom_kv(uid, item)
      if parent_uid ~= nil then
        attached = attached + 1
      elseif add_child(parent_uid, uid) then
        attached = attached + 1
      end
      pcall(function() EditorAPI.set_unit_attr(uid, "position", pos) end)
      created = created + 1
      existing[item.name] = uid
    else
      failed = failed + 1
      emit("FAIL:" .. tostring(index) .. ":" .. tostring(item.prefabId) .. ":" .. tostring(uid) .. ":" .. item.name)
    end
  end
end

local faction_spawn_uid = existing["分阵营出生点1"] or existing["分阵营出生点"] or 1401993508
set_builtin_spawn_point(faction_spawn_uid, "分阵营出生点")
local ok_trial_spawns, trial_spawns = pcall(function() return EditorAPI.query_unit_ids("蛋仔：试玩出生点", false) end)
if ok_trial_spawns and trial_spawns ~= nil and #trial_spawns > 0 then
  local item = trial_spawns[1]
  local uid = item
  if type(item) == "table" then
    uid = item.id or item.uid or item.unit_id or item[1]
  end
  set_builtin_spawn_point(uid, "蛋仔：试玩出生点")
else
  emit("SPAWN_MOVE_FAIL:蛋仔：试玩出生点:not_found")
end

emit("DONE:created=" .. tostring(created) .. ":skipped=" .. tostring(skipped) .. ":failed=" .. tostring(failed) .. ":total=" .. tostring(#ITEMS) .. ":roots_created=" .. tostring(roots_created) .. ":roots_skipped=" .. tostring(roots_skipped) .. ":attached=" .. tostring(attached) .. ":replaced=" .. tostring(replaced))
"""


def plan_item_dict(item: SceneItem) -> dict[str, Any]:
    data = asdict(item)
    if data.get("custom_kv") is None:
        data.pop("custom_kv", None)
    data.update({
        "full_name": item.full_name,
        "legacy_full_name": item.legacy_full_name,
        "parent_name": item.parent_name,
    })
    return data


def parse_summary(log_text: str, run_id: str) -> dict[str, int]:
    summary = {"created": 0, "skipped": 0, "failed": 0, "total": 0, "roots_created": 0, "roots_skipped": 0, "attached": 0}
    prefix = f"{MARKER}:{run_id}:DONE:"
    for line in log_text.splitlines():
        if prefix not in line:
            continue
        payload = line.split(prefix, 1)[1].strip().strip('"')
        for key, value in re.findall(r"(created|skipped|failed|total|roots_created|roots_skipped|attached)=(\d+)", payload):
            summary[key] = int(value)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create quick-runner editor scene from Zulijian terrain data.")
    add_workspace_argument(parser)
    add_editor_transport_arguments(parser)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--plan-out", default="tools/zlj_editor_scene/latest_plan.json")
    parser.add_argument("--batch-size", type=int, default=40)
    parser.add_argument("--start-index", type=int, default=0, help="0-based plan item index to start from.")
    parser.add_argument("--limit", type=int, default=0, help="Maximum number of plan items to execute; 0 means all remaining.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = args.workspace.resolve()
    items = build_plan(workspace)
    plan_path = workspace / args.plan_out
    plan_path.parent.mkdir(parents=True, exist_ok=True)
    plan_path.write_text(
        json.dumps(
            [
                plan_item_dict(item)
                for item in items
            ],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    if args.dry_run:
        dump_json({"ok": True, "dry_run": True, "plan_path": str(plan_path), "items": len(items)}, compact=False)
        return 0

    start_index = max(0, int(args.start_index))
    if start_index > len(items):
        raise ValueError(f"--start-index 超出计划范围: {start_index} > {len(items)}")
    run_items = items[start_index:]
    if args.limit and args.limit > 0:
        run_items = run_items[: args.limit]

    total_summary = {"created": 0, "skipped": 0, "failed": 0, "total": 0, "roots_created": 0, "roots_skipped": 0, "attached": 0}
    batch_size = max(1, int(args.batch_size))
    batches = [run_items[index : index + batch_size] for index in range(0, len(run_items), batch_size)]
    for batch_index, batch in enumerate(batches, start=1):
        run_id = f"{int(time.time())}_{batch_index}"
        log_text = run_editor_lua_and_collect_logs(
            workspace,
            build_lua(batch, run_id),
            mode=args.mode,
            backend_ws_url=args.backend_ws_url,
            timeout=args.timeout,
            progress=lambda msg: print(msg, file=sys.stderr),
            marker_prefixes=[MARKER],
        )
        summary = parse_summary(log_text, run_id)
        print(json.dumps({"batch": batch_index, "batches": len(batches), "summary": summary}, ensure_ascii=False), file=sys.stderr)
        for key in total_summary:
            total_summary[key] += summary[key]
    ok = total_summary["total"] == len(run_items) and total_summary["failed"] == 0
    dump_json(
        {
            "ok": ok,
            "plan_path": str(plan_path),
            "items": len(items),
            "run_items": len(run_items),
            "start_index": start_index,
            "batches": len(batches),
            "summary": total_summary,
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
