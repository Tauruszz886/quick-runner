#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math
from pathlib import Path

import ezdxf
from ezdxf.acis import api as acis_api
from ezdxf.entities import Line
from ezdxf.math import Matrix44, Vec3


TARGET_HANDLE = "84C"
SVG_INDEX = "11"
COMPONENT_NAME = "QR_第03关_dxf_84C_24x17_1875"
UNIT_ID = "1032584478"

OLD_LEFT = 92.0
OLD_RIGHT = 116.0
NEW_LEFT = 94.0
NEW_RIGHT = 114.0
TOP = 29.6875
BOTTOM = 46.875


def close(a: float, b: float, eps: float = 1e-4) -> bool:
    return abs(a - b) <= eps


def require_line(doc: ezdxf.EzDxf, handle: str) -> Line:
    entity = doc.entitydb[handle]
    if entity.dxftype() != "LINE":
        raise TypeError(f"handle {handle} is {entity.dxftype()}, expected LINE")
    return entity


def set_line(line: Line, start: Vec3, end: Vec3) -> None:
    line.dxf.start = start
    line.dxf.end = end


def world(local_x: float, local_y: float, origin_x: float, origin_y: float) -> Vec3:
    return Vec3(origin_x + local_x, origin_y + local_y, 0.0)


def find_level_origin(doc: ezdxf.EzDxf) -> tuple[float, float]:
    for entity in doc.modelspace():
        if entity.dxftype() != "LWPOLYLINE":
            continue
        points = [(float(p[0]), float(p[1])) for p in entity.get_points("xy")]
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        if close(max(xs) - min(xs), 160.0) and close(max(ys) - min(ys), 100.0):
            return min(xs), min(ys)
    raise RuntimeError("未找到 160x100 的第 3 关 CAD 图框")


def update_solid(doc: ezdxf.EzDxf, origin_x: float, origin_y: float) -> dict[str, object]:
    entity = doc.entitydb[TARGET_HANDLE]
    if entity.dxftype() != "3DSOLID":
        raise TypeError(f"handle {TARGET_HANDLE} is {entity.dxftype()}, expected 3DSOLID")

    bodies = acis_api.load(entity.acis_data)
    if len(bodies) != 1:
        raise RuntimeError(f"handle {TARGET_HANDLE} expected 1 ACIS body, got {len(bodies)}")

    mesh = acis_api.mesh_from_body(bodies[0])[0]
    old_bbox = mesh.bbox()
    old_size = old_bbox.size
    center_x = (old_bbox.extmin.x + old_bbox.extmax.x) / 2.0
    center_y = (old_bbox.extmin.y + old_bbox.extmax.y) / 2.0

    expected_left = origin_x + OLD_LEFT
    expected_right = origin_x + OLD_RIGHT
    expected_top = origin_y + TOP
    expected_bottom = origin_y + BOTTOM

    if not (
        close(old_bbox.extmin.y, expected_top)
        and close(old_bbox.extmax.y, expected_bottom)
        and close(center_x, origin_x + (OLD_LEFT + OLD_RIGHT) / 2.0, 1e-3)
    ):
        raise RuntimeError(
            "84C ACIS bbox 与预期位置不一致: "
            f"{old_bbox.extmin} -> {old_bbox.extmax}"
        )

    if close(old_bbox.extmin.x, origin_x + NEW_LEFT) and close(
        old_bbox.extmax.x, origin_x + NEW_RIGHT
    ):
        return {
            "solid_changed": False,
            "old_bbox": old_bbox,
            "new_bbox": old_bbox,
        }

    if not (close(old_bbox.extmin.x, expected_left) and close(old_bbox.extmax.x, expected_right)):
        raise RuntimeError(
            "84C ACIS 宽度不是旧值，也不是新值: "
            f"{old_bbox.extmin} -> {old_bbox.extmax}"
        )

    scale_x = (NEW_RIGHT - NEW_LEFT) / (OLD_RIGHT - OLD_LEFT)
    mesh.transform(
        Matrix44.chain(
            Matrix44.translate(-center_x, -center_y, 0.0),
            Matrix44.scale(scale_x, 1.0, 1.0),
            Matrix44.translate(center_x, center_y, 0.0),
        )
    )
    new_body = acis_api.body_from_mesh(mesh, precision=12)
    entity.sab = acis_api.export_sab([new_body], version=21800)

    new_mesh = acis_api.mesh_from_body(acis_api.load(entity.acis_data)[0])[0]
    return {
        "solid_changed": True,
        "old_bbox": old_bbox,
        "new_bbox": new_mesh.bbox(),
        "old_size": old_size,
    }


def update_projection_lines(doc: ezdxf.EzDxf, origin_x: float, origin_y: float) -> None:
    msp = doc.modelspace()

    # 顶边：原 92..116 改为 94..114。
    set_line(
        require_line(doc, "80B"),
        world(NEW_RIGHT, TOP, origin_x, origin_y),
        world(NEW_LEFT, TOP, origin_x, origin_y),
    )

    # 左边：从 x=92 移到 x=94。
    set_line(
        require_line(doc, "80C"),
        world(NEW_LEFT, TOP, origin_x, origin_y),
        world(NEW_LEFT, BOTTOM, origin_x, origin_y),
    )

    # 右边原来包含在长竖线 7FB 里；拆掉目标区间，并新增 x=114 的目标右边。
    long_right = require_line(doc, "7FB")
    layer = long_right.dxf.layer
    set_line(
        long_right,
        world(OLD_RIGHT, 6.25, origin_x, origin_y),
        world(OLD_RIGHT, TOP, origin_x, origin_y),
    )
    msp.add_line(
        world(OLD_RIGHT, BOTTOM, origin_x, origin_y),
        world(OLD_RIGHT, 93.75, origin_x, origin_y),
        dxfattribs={"layer": layer},
    )
    msp.add_line(
        world(NEW_RIGHT, TOP, origin_x, origin_y),
        world(NEW_RIGHT, BOTTOM, origin_x, origin_y),
        dxfattribs={"layer": layer},
    )

    # 底边原来是整行共享长线；只移除 84C 旧的 92..116 区间并补新底边 94..114。
    bottom_line = require_line(doc, "80A")
    bottom_layer = bottom_line.dxf.layer
    set_line(
        bottom_line,
        world(OLD_LEFT, BOTTOM, origin_x, origin_y),
        world(28.0, BOTTOM, origin_x, origin_y),
    )
    msp.add_line(
        world(124.0, BOTTOM, origin_x, origin_y),
        world(OLD_RIGHT, BOTTOM, origin_x, origin_y),
        dxfattribs={"layer": bottom_layer},
    )
    msp.add_line(
        world(NEW_RIGHT, BOTTOM, origin_x, origin_y),
        world(NEW_LEFT, BOTTOM, origin_x, origin_y),
        dxfattribs={"layer": bottom_layer},
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dxf", type=Path)
    parser.add_argument("output_dxf", type=Path)
    args = parser.parse_args()

    doc = ezdxf.readfile(args.input_dxf)
    origin_x, origin_y = find_level_origin(doc)
    solid_result = update_solid(doc, origin_x, origin_y)
    update_projection_lines(doc, origin_x, origin_y)

    args.output_dxf.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(args.output_dxf)

    old_bbox = solid_result["old_bbox"]
    new_bbox = solid_result["new_bbox"]
    print(f"SVG编号: {SVG_INDEX}")
    print(f"组件: {COMPONENT_NAME}")
    print(f"unit_id: {UNIT_ID}")
    print(f"CAD handle: {TARGET_HANDLE}")
    print(f"图框原点: ({origin_x:.12f}, {origin_y:.12f})")
    print(f"ACIS changed: {solid_result['solid_changed']}")
    print(f"old bbox: {old_bbox.extmin} -> {old_bbox.extmax}, size={old_bbox.size}")
    print(f"new bbox: {new_bbox.extmin} -> {new_bbox.extmax}, size={new_bbox.size}")
    print(f"输出: {args.output_dxf}")


if __name__ == "__main__":
    main()
