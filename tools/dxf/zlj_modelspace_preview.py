#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
import json
from pathlib import Path
from typing import Any

import ezdxf

from solid_acis_preview import _bounds, _dedupe, _parse_solid


def _round(value: float) -> float:
    return round(float(value), 6)


def _line_points(entity: Any) -> tuple[tuple[float, float], tuple[float, float]]:
    start = entity.dxf.start
    end = entity.dxf.end
    return (float(start.x), float(start.y)), (float(end.x), float(end.y))


def _find_frame(lines: list[dict[str, Any]]) -> dict[str, float]:
    xs = [point[0] for line in lines for point in (line["start"], line["end"])]
    ys = [point[1] for line in lines for point in (line["start"], line["end"])]
    return {
        "min_x": min(xs),
        "max_x": max(xs),
        "min_y": min(ys),
        "max_y": max(ys),
        "sx": max(xs) - min(xs),
        "sz": max(ys) - min(ys),
    }


def _local(point: tuple[float, float], frame: dict[str, float]) -> tuple[float, float]:
    return point[0] - frame["min_x"], point[1] - frame["min_y"]


def _svg_point(point: tuple[float, float], scale: float, ox: float, oy: float) -> tuple[float, float]:
    return ox + point[0] * scale, oy + point[1] * scale


def _solid_footprint(solid: Any, frame: dict[str, float]) -> dict[str, Any]:
    vertices = _dedupe([vertex for face in solid.model_faces for vertex in face])
    bounds = _bounds(vertices)
    min_x, min_y = bounds["min"][0], bounds["min"][1]
    max_x, max_y = bounds["max"][0], bounds["max"][1]
    start_x, start_z = _local((min_x, min_y), frame)
    return {
        "handle": solid.handle,
        "uid": solid.uid,
        "history_handle": solid.history_handle,
        "startX": _round(start_x),
        "startZ": _round(start_z),
        "sx": _round(max_x - min_x),
        "sz": _round(max_y - min_y),
        "model_bounds": bounds,
    }


def build_preview(dxf_path: Path, svg_path: Path, json_path: Path) -> None:
    digest = hashlib.sha256(dxf_path.read_bytes()).hexdigest()
    doc = ezdxf.readfile(dxf_path)
    ms = doc.modelspace()

    lines: list[dict[str, Any]] = []
    dimensions: list[dict[str, Any]] = []
    solids = []

    for entity in ms:
        if entity.dxftype() == "LINE":
            start, end = _line_points(entity)
            lines.append({"handle": entity.dxf.handle, "start": start, "end": end})
        elif entity.dxftype() == "DIMENSION":
            attrs = entity.dxfattribs()
            midpoint = attrs.get("text_midpoint")
            dimensions.append(
                {
                    "handle": entity.dxf.handle,
                    "actual_measurement": _round(attrs.get("actual_measurement", 0.0)),
                    "text_midpoint": (float(midpoint.x), float(midpoint.y)) if midpoint is not None else None,
                }
            )
        elif entity.dxftype() == "3DSOLID":
            _header, solid = _parse_solid(entity)
            solids.append(solid)

    if not lines:
        raise RuntimeError("no LINE entities found")

    frame = _find_frame(lines)
    local_lines: list[dict[str, Any]] = []
    for line in lines:
        local_lines.append(
            {
                "handle": line["handle"],
                "start": [_round(v) for v in _local(line["start"], frame)],
                "end": [_round(v) for v in _local(line["end"], frame)],
            }
        )

    footprints = [_solid_footprint(solid, frame) for solid in solids]

    scale = 5.2
    ox = 52.0
    oy = 74.0
    drawing_w = frame["sx"] * scale
    drawing_h = frame["sz"] * scale
    width = drawing_w + 420.0
    height = drawing_h + 150.0

    colors = ["#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#22d3ee", "#fb7185", "#4ade80"]
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{height:.0f}" viewBox="0 0 {width:.2f} {height:.2f}">',
        "<style>",
        "text{font-family:Arial,'Microsoft YaHei',sans-serif;fill:#172033}.title{font-size:18px;font-weight:700}.meta{font-size:12px}.label{font-size:10px;font-weight:700}.line{stroke:#1f2937;stroke-width:1.5;stroke-linecap:square}.frame{stroke:#0f172a;stroke-width:3;fill:none}.solid{stroke:#111827;stroke-width:1;fill-opacity:.42}.dim{fill:#334155;font-size:13px;font-weight:700}",
        "</style>",
        '<rect width="100%" height="100%" fill="#f8fafc"/>',
        f'<text class="title" x="24" y="30">第六关 DXF modelspace / ZLJ 本地坐标预览</text>',
        f'<text class="meta" x="24" y="52">来源: {html.escape(str(dxf_path))} sha256={digest[:16]}...；只显示 LINE 外框={frame["sx"]:.0f}x{frame["sz"]:.0f} 与 3DSOLID/ACIS 实体足迹</text>',
        f'<g transform="translate({ox:.2f},{oy:.2f})">',
        f'<rect class="frame" x="0" y="0" width="{drawing_w:.2f}" height="{drawing_h:.2f}"/>',
        f'<text class="meta" x="0" y="-12">localX 0..{frame["sx"]:.0f}</text>',
        f'<text class="meta" x="{drawing_w - 64:.2f}" y="{drawing_h + 24:.2f}">localZ 0..{frame["sz"]:.0f}</text>',
    ]

    frame_lines = []
    seen_frame_segments: set[tuple[tuple[float, float], tuple[float, float]]] = set()
    for line in local_lines:
        x1, y1 = line["start"]
        x2, y2 = line["end"]
        is_frame = (
            abs(x1 - x2) < 1e-6 and abs(abs(y2 - y1) - frame["sz"]) < 1e-6
        ) or (
            abs(y1 - y2) < 1e-6 and abs(abs(x2 - x1) - frame["sx"]) < 1e-6
        )
        if not is_frame:
            continue
        a = (round(x1, 6), round(y1, 6))
        b = (round(x2, 6), round(y2, 6))
        segment_key = tuple(sorted((a, b)))
        if segment_key in seen_frame_segments:
            continue
        seen_frame_segments.add(segment_key)
        frame_lines.append(line)
        p1 = _svg_point((x1, y1), scale, 0, 0)
        p2 = _svg_point((x2, y2), scale, 0, 0)
        parts.append(
            f'<line class="frame" x1="{p1[0]:.2f}" y1="{p1[1]:.2f}" x2="{p2[0]:.2f}" y2="{p2[1]:.2f}"><title>{line["handle"]}: {line["start"]} -> {line["end"]}</title></line>'
        )

    for index, fp in enumerate(footprints):
        x, y = _svg_point((fp["startX"], fp["startZ"]), scale, 0, 0)
        w = fp["sx"] * scale
        h = fp["sz"] * scale
        color = colors[index % len(colors)]
        parts.append(
            f'<rect class="solid" x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" fill="{color}"><title>3DSOLID {fp["handle"]}: start=({fp["startX"]},{fp["startZ"]}) size=({fp["sx"]},{fp["sz"]})</title></rect>'
        )
        parts.append(f'<text class="label" x="{x + w / 2:.2f}" y="{y + h / 2 + 3:.2f}" text-anchor="middle">{fp["handle"]}</text>')

    parts.append("</g>")
    legend_x = ox + drawing_w + 28.0
    legend_y = oy + 4.0
    parts.append(f'<g transform="translate({legend_x:.2f},{legend_y:.2f})">')
    parts.append('<text class="meta" x="0" y="0">读取规则：</text>')
    parts.append('<text class="meta" x="0" y="22">1. modelspace LINE 只保留 160x100 外框。</text>')
    parts.append('<text class="meta" x="0" y="42">2. 外框 min 点归一化为 ZLJ local (0,0)。</text>')
    parts.append('<text class="meta" x="0" y="62">3. 半透明块为 3DSOLID/ACIS 顶点足迹。</text>')
    for index, fp in enumerate(footprints):
        y = 94 + index * 20
        parts.append(f'<rect x="0" y="{y - 10}" width="12" height="12" fill="{colors[index % len(colors)]}" fill-opacity=".42" stroke="#111827"/>')
        parts.append(f'<text class="meta" x="18" y="{y}">{fp["handle"]}: start=({fp["startX"]},{fp["startZ"]}) size=({fp["sx"]},{fp["sz"]})</text>')
    parts.append("</g>")
    parts.append("</svg>")

    summary = {
        "source": str(dxf_path),
        "sha256": digest,
        "dxf_version": doc.dxfversion,
        "frame": {key: _round(value) for key, value in frame.items()},
        "line_count": len(lines),
        "dimension_count": len(dimensions),
        "solid_count": len(solids),
        "lines": local_lines,
        "frame_lines": frame_lines,
        "dimensions": dimensions,
        "solid_footprints": footprints,
    }
    svg_path.write_text("\n".join(parts), encoding="utf-8")
    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dxf", type=Path)
    parser.add_argument("--svg", type=Path, required=True)
    parser.add_argument("--json", type=Path, required=True)
    args = parser.parse_args()
    build_preview(args.dxf, args.svg, args.json)


if __name__ == "__main__":
    main()
