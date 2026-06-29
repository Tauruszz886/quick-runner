#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import ezdxf
from ezdxf.acis import const
from ezdxf.acis.sab import Decoder


Vec3 = tuple[float, float, float]
Face = list[Vec3]


@dataclass
class SolidMesh:
    handle: str
    uid: str | None
    history_handle: str | None
    local_faces: list[Face]
    model_faces: list[Face]
    transform: dict[str, Any] | None


def _record_type(record: list[Any]) -> str | None:
    if record and record[0].tag == const.Tags.ENTITY_TYPE:
        return record[0].value
    return None


def _ptr(record: list[Any], index: int) -> int:
    value = record[index].value
    if not isinstance(value, int):
        raise TypeError(f"expected pointer/int at token {index}, got {record[index]}")
    return value


def _bool(record: list[Any], index: int) -> bool:
    value = record[index].value
    if not isinstance(value, bool):
        raise TypeError(f"expected bool at token {index}, got {record[index]}")
    return value


def _vec(record: list[Any], index: int) -> Vec3:
    value = record[index].value
    if len(value) != 3:
        raise TypeError(f"expected vec3 at token {index}, got {record[index]}")
    return float(value[0]), float(value[1]), float(value[2])


def _add(a: Vec3, b: Vec3) -> Vec3:
    return a[0] + b[0], a[1] + b[1], a[2] + b[2]


def _mul(a: Vec3, s: float) -> Vec3:
    return a[0] * s, a[1] * s, a[2] * s


def _apply_transform(point: Vec3, transform: dict[str, Any] | None) -> Vec3:
    if not transform:
        return point
    x_axis, y_axis, z_axis = transform["axes"]
    origin = transform["origin"]
    scale = float(transform.get("scale", 1.0))
    return _add(
        origin,
        _add(
            _add(_mul(x_axis, point[0] * scale), _mul(y_axis, point[1] * scale)),
            _mul(z_axis, point[2] * scale),
        ),
    )


def _decode_records(sab: bytes) -> tuple[Any, list[list[Any]], dict[int, list[Any]]]:
    decoder = Decoder(sab)
    header = decoder.read_header()
    records = list(decoder.read_records())
    return header, records, {index: record for index, record in enumerate(records)}


def _parse_transform(record: list[Any]) -> dict[str, Any]:
    return {
        "axes": [_vec(record, 3), _vec(record, 4), _vec(record, 5)],
        "origin": _vec(record, 6),
        "scale": float(record[7].value),
        "flags": {
            "bool_8": bool(record[8].value),
            "bool_9": bool(record[9].value),
            "bool_10": bool(record[10].value),
        },
    }


def _point_location(records: dict[int, list[Any]], vertex_id: int) -> Vec3:
    vertex = records[vertex_id]
    if _record_type(vertex) != "vertex":
        raise TypeError(f"record {vertex_id} is not a vertex")
    point_id = _ptr(vertex, 6)
    point = records[point_id]
    if _record_type(point) != "point":
        raise TypeError(f"record {point_id} is not a point")
    return _vec(point, 4)


def _edge_vertex(records: dict[int, list[Any]], edge_id: int, reversed_sense: bool) -> Vec3:
    edge = records[edge_id]
    if _record_type(edge) != "edge":
        raise TypeError(f"record {edge_id} is not an edge")
    vertex_id = _ptr(edge, 6 if reversed_sense else 4)
    return _point_location(records, vertex_id)


def _face_from_loop(records: dict[int, list[Any]], loop_id: int) -> Face:
    loop = records[loop_id]
    if _record_type(loop) != "loop":
        raise TypeError(f"record {loop_id} is not a loop")
    first_coedge = _ptr(loop, 5)
    face: Face = []
    coedge_id = first_coedge
    visited: set[int] = set()
    while coedge_id != -1 and coedge_id not in visited:
        visited.add(coedge_id)
        coedge = records[coedge_id]
        if _record_type(coedge) != "coedge":
            raise TypeError(f"record {coedge_id} is not a coedge")
        edge_id = _ptr(coedge, 7)
        face.append(_edge_vertex(records, edge_id, _bool(coedge, 8)))
        coedge_id = _ptr(coedge, 4)
        if coedge_id == first_coedge:
            break
    return face


def _parse_solid(entity: Any) -> tuple[Any, SolidMesh]:
    header, records, by_id = _decode_records(entity.sab)
    body_id = next(i for i, record in enumerate(records) if _record_type(record) == "body")
    body = by_id[body_id]
    transform_id = _ptr(body, 6)
    transform = _parse_transform(by_id[transform_id]) if transform_id != -1 else None

    faces: list[Face] = []
    for record_id, record in by_id.items():
        if _record_type(record) != "face":
            continue
        loop_id = _ptr(record, 5)
        surface_id = _ptr(record, 8)
        if loop_id == -1 or surface_id == -1:
            continue
        surface = by_id[surface_id]
        if _record_type(surface) != "plane-surface":
            continue
        face = _face_from_loop(by_id, loop_id)
        if len(face) >= 3:
            faces.append(face)

    model_faces = [[_apply_transform(vertex, transform) for vertex in face] for face in faces]
    attrs = entity.dxfattribs()
    return header, SolidMesh(
        handle=entity.dxf.handle,
        uid=attrs.get("uid"),
        history_handle=attrs.get("history_handle"),
        local_faces=faces,
        model_faces=model_faces,
        transform=transform,
    )


def _bounds(points: list[Vec3]) -> dict[str, list[float]]:
    mins = [min(p[i] for p in points) for i in range(3)]
    maxs = [max(p[i] for p in points) for i in range(3)]
    size = [maxs[i] - mins[i] for i in range(3)]
    center = [(mins[i] + maxs[i]) / 2.0 for i in range(3)]
    return {
        "min": [round(v, 6) for v in mins],
        "max": [round(v, 6) for v in maxs],
        "size": [round(v, 6) for v in size],
        "center": [round(v, 6) for v in center],
    }


def _dedupe(points: list[Vec3], precision: int = 6) -> list[Vec3]:
    seen: dict[tuple[float, float, float], Vec3] = {}
    for point in points:
        key = tuple(round(value, precision) for value in point)
        seen.setdefault(key, point)
    return list(seen.values())


def _normal(face: Face) -> Vec3:
    if len(face) < 3:
        return 0.0, 0.0, 0.0
    ax, ay, az = face[0]
    bx, by, bz = face[1]
    cx, cy, cz = face[2]
    ux, uy, uz = bx - ax, by - ay, bz - az
    vx, vy, vz = cx - ax, cy - ay, cz - az
    return uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx


def _project(point: Vec3) -> tuple[float, float]:
    x, y, z = point
    return (x - y) * 2.7, (x + y) * 1.15 - z * 7.5


def _svg(solid_meshes: list[SolidMesh], source: Path, digest: str) -> str:
    faces: list[tuple[float, SolidMesh, Face, list[tuple[float, float]], Vec3]] = []
    for solid in solid_meshes:
        for face in solid.model_faces:
            points_2d = [_project(vertex) for vertex in face]
            depth = sum(vertex[0] + vertex[1] + vertex[2] for vertex in face) / len(face)
            faces.append((depth, solid, face, points_2d, _normal(face)))
    faces.sort(key=lambda item: item[0])

    all_2d = [point for _, _, _, points, _ in faces for point in points]
    min_x = min(x for x, _ in all_2d)
    max_x = max(x for x, _ in all_2d)
    min_y = min(y for _, y in all_2d)
    max_y = max(y for _, y in all_2d)
    pad = 44.0
    drawing_left = 36.0
    drawing_top = 72.0
    drawing_width = max_x - min_x + pad * 2
    drawing_height = max_y - min_y + pad * 2
    legend_width = 520.0
    width = drawing_left + drawing_width + legend_width
    height = max(drawing_top + drawing_height + 32.0, 92.0 + len(solid_meshes) * 22.0)

    def sx(point: tuple[float, float]) -> tuple[float, float]:
        return point[0] - min_x + pad + drawing_left, point[1] - min_y + pad + drawing_top

    colors = [
        "#b8d7ff", "#ffd494", "#a7e6c2", "#f5b4d0",
        "#c8c2ff", "#ffe889", "#9fdde8", "#f4b49d",
    ]
    handle_to_color = {solid.handle: colors[index % len(colors)] for index, solid in enumerate(solid_meshes)}

    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{height:.0f}" viewBox="0 0 {width:.2f} {height:.2f}">',
        "<style>",
        "text{font-family:Arial,'Microsoft YaHei',sans-serif;fill:#172033} .meta{font-size:12px} .label{font-size:11px;font-weight:700} polygon{stroke:#293445;stroke-width:.7;stroke-linejoin:round} .axis{stroke:#5f6f86;stroke-width:1.2;marker-end:url(#arrow)}",
        "</style>",
        '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#5f6f86"/></marker></defs>',
        f'<rect width="100%" height="100%" fill="#f7f9fc"/>',
        f'<text x="16" y="22" class="meta">3DSOLID / ACIS isometric preview - {html.escape(source.name)}</text>',
        f'<text x="16" y="40" class="meta">source sha256: {digest[:16]}..., solids: {len(solid_meshes)}, generated from SAB face-edge-vertex records</text>',
    ]

    for _, solid, _face, points, normal in faces:
        transformed = [sx(point) for point in points]
        polygon = " ".join(f"{x:.2f},{y:.2f}" for x, y in transformed)
        brightness = 0.72 + min(0.22, max(-0.18, normal[2] / 80.0))
        opacity = max(0.50, min(0.94, brightness))
        parts.append(
            f'<polygon points="{polygon}" fill="{handle_to_color[solid.handle]}" fill-opacity="{opacity:.2f}"/>'
        )

    for solid in solid_meshes:
        vertices = _dedupe([vertex for face in solid.model_faces for vertex in face])
        center = tuple(sum(p[i] for p in vertices) / len(vertices) for i in range(3))
        x, y = sx(_project(center))
        parts.append(f'<text x="{x:.2f}" y="{y:.2f}" text-anchor="middle" class="label">{solid.handle}</text>')

    legend_x = drawing_left + drawing_width + 24.0
    legend_y = 92.0
    parts.append(f'<g transform="translate({legend_x:.2f},{legend_y:.2f})">')
    for index, solid in enumerate(solid_meshes):
        b = _bounds(_dedupe([vertex for face in solid.model_faces for vertex in face]))
        y = index * 22
        parts.append(f'<rect x="0" y="{y - 9}" width="10" height="10" fill="{handle_to_color[solid.handle]}" stroke="#293445" stroke-width=".5"/>')
        parts.append(
            f'<text x="16" y="{y}" class="meta">{solid.handle}: center {b["center"]}, size {b["size"]}</text>'
        )
    parts.append("</g>")

    parts.append("</svg>")
    return "\n".join(parts)


def build_preview(dxf_path: Path, svg_path: Path, json_path: Path) -> None:
    data = dxf_path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    doc = ezdxf.readfile(dxf_path)
    solid_meshes: list[SolidMesh] = []
    headers: list[dict[str, Any]] = []

    for entity in doc.modelspace():
        if entity.dxftype() != "3DSOLID":
            continue
        header, mesh = _parse_solid(entity)
        headers.append(
            {
                "handle": entity.dxf.handle,
                "version": header.version,
                "acis_version": header.acis_version,
                "product_id": header.product_id,
                "creation_date": header.creation_date.isoformat(),
                "units_in_mm": header.units_in_mm,
            }
        )
        solid_meshes.append(mesh)

    if not solid_meshes:
        raise RuntimeError("no 3DSOLID entities found")

    summary = {
        "source": str(dxf_path),
        "sha256": digest,
        "dxf_version": doc.dxfversion,
        "solid_count": len(solid_meshes),
        "headers": headers,
        "solids": [],
    }
    for solid in solid_meshes:
        local_vertices = _dedupe([vertex for face in solid.local_faces for vertex in face])
        model_vertices = _dedupe([vertex for face in solid.model_faces for vertex in face])
        summary["solids"].append(
            {
                "handle": solid.handle,
                "uid": solid.uid,
                "history_handle": solid.history_handle,
                "face_count": len(solid.model_faces),
                "local_vertex_count": len(local_vertices),
                "model_vertex_count": len(model_vertices),
                "local_bounds": _bounds(local_vertices),
                "model_bounds": _bounds(model_vertices),
                "transform": solid.transform,
                "faces": [
                    [[round(value, 6) for value in vertex] for vertex in face]
                    for face in solid.model_faces
                ],
            }
        )

    svg_path.write_text(_svg(solid_meshes, dxf_path, digest), encoding="utf-8")
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
