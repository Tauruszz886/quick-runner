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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
