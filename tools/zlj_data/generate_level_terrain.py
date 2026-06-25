#!/usr/bin/env python3
"""Generate TypeScript level data files from structured JSON."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


REQUIRED_FIELDS = ("name", "startX", "startZ", "sx", "sy", "sz")
OPTIONAL_FIELDS = ("baseY", "prefabId", "role")
FIELD_ORDER = REQUIRED_FIELDS + OPTIONAL_FIELDS
FALL_DEATH_ZONE_FIELDS = ("module", "name", "startX", "startZ", "sx", "sz")
RUNTIME_BINDING_FIELDS = ("module", "component", "role", "moveZ", "moving")
RUNTIME_BINDING_REQUIRED_FIELDS = ("module", "component", "role")


def format_number(value: Any) -> str:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise TypeError(f"expected number, got {value!r}")
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.10f}".rstrip("0").rstrip(".")


def format_value(key: str, value: Any) -> str:
    if key in ("name", "role", "component"):
        if not isinstance(value, str):
            raise TypeError(f"{key} must be a string")
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, bool):
        return "true" if value else "false"
    return format_number(value)


def load_level_data(path: Path) -> tuple[int, list[dict[str, Any]]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    level = raw.get("level")
    terrain = raw.get("terrain")
    if not isinstance(level, int):
        raise TypeError(f"{path}: level must be an integer")
    if not isinstance(terrain, list):
        raise TypeError(f"{path}: terrain must be a list")

    specs: list[dict[str, Any]] = []
    for index, spec in enumerate(terrain, start=1):
        if not isinstance(spec, dict):
            raise TypeError(f"{path}: terrain[{index}] must be an object")
        missing = [field for field in REQUIRED_FIELDS if field not in spec]
        if missing:
            raise ValueError(f"{path}: terrain[{index}] missing {', '.join(missing)}")
        allowed = set(FIELD_ORDER)
        extra = sorted(set(spec) - allowed)
        if extra:
            raise ValueError(f"{path}: terrain[{index}] has unknown fields {', '.join(extra)}")
        specs.append(spec)
    return level, specs


def terrain_const_name(level: int) -> str:
    return f"LEVEL_{level:02d}_TERRAIN"


def format_spec(spec: dict[str, Any]) -> str:
    fields = [field for field in FIELD_ORDER if field in spec]
    body = ", ".join(f"{field}: {format_value(field, spec[field])}" for field in fields)
    return f"  {{ {body} }},"


def render_terrain_ts(level: int, specs: list[dict[str, Any]]) -> str:
    lines = [
        "import type { LevelTerrainSpec } from \"../shared/types\"",
        "",
        "// Generated from data/zlj/levels/level_%02d.json. Do not edit terrain data here." % level,
        f"export const {terrain_const_name(level)}: readonly LevelTerrainSpec[] = [",
    ]
    lines.extend(format_spec(spec) for spec in specs)
    lines.append("]")
    lines.append("")
    return "\n".join(lines)


def output_path_for(workspace: Path, level: int) -> Path:
    return workspace / "ts_src" / "zlj" / "levels" / f"level_{level:02d}" / "terrain.ts"


def generate_file(workspace: Path, data_path: Path) -> Path:
    level, specs = load_level_data(data_path)
    output_path = output_path_for(workspace, level)
    output_path.write_text(render_terrain_ts(level, specs), encoding="utf-8")
    return output_path


def load_fall_death_zones(path: Path) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    zones = raw.get("zones")
    if not isinstance(zones, list):
        raise TypeError(f"{path}: zones must be a list")

    out: list[dict[str, Any]] = []
    for index, zone in enumerate(zones, start=1):
        if not isinstance(zone, dict):
            raise TypeError(f"{path}: zones[{index}] must be an object")
        missing = [field for field in FALL_DEATH_ZONE_FIELDS if field not in zone]
        if missing:
            raise ValueError(f"{path}: zones[{index}] missing {', '.join(missing)}")
        extra = sorted(set(zone) - set(FALL_DEATH_ZONE_FIELDS))
        if extra:
            raise ValueError(f"{path}: zones[{index}] has unknown fields {', '.join(extra)}")
        out.append(zone)
    return out


def render_fall_death_zones_ts(zones: list[dict[str, Any]]) -> str:
    lines = [
        "import type { FallDeathZoneSpec } from \"./shared/types\"",
        "",
        "// Generated from data/zlj/fall_death_zones.json. Do not edit zone data here.",
        "export const FALL_DEATH_ZONES: readonly FallDeathZoneSpec[] = [",
    ]
    for zone in zones:
        body = ", ".join(f"{field}: {format_value(field, zone[field])}" for field in FALL_DEATH_ZONE_FIELDS)
        lines.append(f"  {{ {body} }},")
    lines.append("]")
    lines.append("")
    return "\n".join(lines)


def generate_fall_death_zones(workspace: Path) -> Path | None:
    data_path = workspace / "data" / "zlj" / "fall_death_zones.json"
    if not data_path.exists():
        return None
    output_path = workspace / "ts_src" / "zlj" / "levels" / "fall_death_zones.ts"
    output_path.write_text(render_fall_death_zones_ts(load_fall_death_zones(data_path)), encoding="utf-8")
    return output_path


def load_runtime_scene_bindings(path: Path) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    bindings = raw.get("bindings")
    if not isinstance(bindings, list):
        raise TypeError(f"{path}: bindings must be a list")

    out: list[dict[str, Any]] = []
    for index, binding in enumerate(bindings, start=1):
        if not isinstance(binding, dict):
            raise TypeError(f"{path}: bindings[{index}] must be an object")
        missing = [field for field in RUNTIME_BINDING_REQUIRED_FIELDS if field not in binding]
        if missing:
            raise ValueError(f"{path}: bindings[{index}] missing {', '.join(missing)}")
        extra = sorted(set(binding) - set(RUNTIME_BINDING_FIELDS))
        if extra:
            raise ValueError(f"{path}: bindings[{index}] has unknown fields {', '.join(extra)}")
        out.append(binding)
    return out


def render_runtime_scene_bindings_ts(bindings: list[dict[str, Any]]) -> str:
    lines = [
        "import type { RuntimeSceneBinding } from \"./shared/types\"",
        "",
        "// Generated from data/zlj/runtime_scene_bindings.json. Do not edit binding data here.",
        "export const RUNTIME_SCENE_BINDINGS: readonly RuntimeSceneBinding[] = [",
    ]
    for binding in bindings:
        fields = [field for field in RUNTIME_BINDING_FIELDS if field in binding]
        body = ", ".join(f"{field}: {format_value(field, binding[field])}" for field in fields)
        lines.append(f"  {{ {body} }},")
    lines.append("]")
    lines.append("")
    return "\n".join(lines)


def generate_runtime_scene_bindings(workspace: Path) -> Path | None:
    data_path = workspace / "data" / "zlj" / "runtime_scene_bindings.json"
    if not data_path.exists():
        return None
    output_path = workspace / "ts_src" / "zlj" / "levels" / "runtime_scene_bindings.ts"
    output_path.write_text(render_runtime_scene_bindings_ts(load_runtime_scene_bindings(data_path)), encoding="utf-8")
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate TS terrain files from data/zlj/levels/*.json.")
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument(
        "paths",
        nargs="*",
        type=Path,
        help="Level JSON files. Defaults to data/zlj/levels/*.json.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = args.workspace.resolve()
    paths = args.paths
    if not paths:
        paths = sorted((workspace / "data" / "zlj" / "levels").glob("level_*.json"))
    if not paths:
        raise FileNotFoundError("no level JSON files found")

    for path in paths:
        data_path = path if path.is_absolute() else workspace / path
        output_path = generate_file(workspace, data_path)
        print(f"generated {output_path.relative_to(workspace)}")
    zones_path = generate_fall_death_zones(workspace)
    if zones_path is not None:
        print(f"generated {zones_path.relative_to(workspace)}")
    bindings_path = generate_runtime_scene_bindings(workspace)
    if bindings_path is not None:
        print(f"generated {bindings_path.relative_to(workspace)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
