import { safeCall } from "@common/engine_safe"
import { TERRAIN_TAG } from "../config"

export type RuntimeSceneRole =
  | "second_chaser_surface"
  | "third_timed_platform"
  | "fourth_compressor"
  | "eighth_moving_part"
  | "ninth_vanishing_platform"
  | "tenth_current"
  | "fall_death"

export type RuntimeSceneUnit = {
  unit: unknown
  role: RuntimeSceneRole
  runtimeName: string
  component: string
  module: number
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
  moveZ?: number
  moving?: boolean
}

const SCENE_ROOT_NAME = "QR_地图_ROOT"
const ROLE_KEY = "QRRole"

function readKv(unit: unknown, valueType: Enums.ValueType, key: string): unknown {
  return safeCall(
    () => {
      const target = unit as any
      if (target.get_kv_by_type === undefined || target.get_kv_by_type === null) {
        return null
      }
      return target.get_kv_by_type(valueType, key)
    },
    { tag: `runtime_scene_scan_kv_${key}`, fallback: null, logger: print }
  )
}

function readStringKv(unit: unknown, key: string): string | undefined {
  const value = readKv(unit, Enums.ValueType.Str, key)
  if (value === null || value === undefined) {
    return undefined
  }
  const text = tostring(value)
  return text === "" ? undefined : text
}

function readNumberKv(unit: unknown, key: string): number | undefined {
  const value = readKv(unit, Enums.ValueType.Fixed, key)
  if (typeof value === "number") {
    return value
  }
  const intValue = readKv(unit, Enums.ValueType.Int, key)
  if (typeof intValue === "number") {
    return intValue
  }
  return undefined
}

function readBoolKv(unit: unknown, key: string): boolean | undefined {
  const value = readKv(unit, Enums.ValueType.Bool, key)
  return typeof value === "boolean" ? value : undefined
}

function getUnitPosition(unit: unknown, name: string): { x: number; y: number; z: number } | null {
  const pos = safeCall(
    () => {
      return (unit as any).get_position()
    },
    { tag: `runtime_scene_scan_position_${name}`, fallback: null, logger: print }
  ) as { x?: number; y?: number; z?: number } | null
  if (pos === null || pos === undefined || pos.x === undefined || pos.y === undefined || pos.z === undefined) {
    print(`[${TERRAIN_TAG}] scene scan skipped name=${name} reason=missing_position`)
    return null
  }
  return { x: pos.x, y: pos.y, z: pos.z }
}

function getUnitScale(unit: unknown, name: string): { x: number; y: number; z: number } | null {
  const scale = safeCall(
    () => {
      const target = unit as any
      if (target.get_scale === undefined || target.get_scale === null) {
        return null
      }
      return target.get_scale()
    },
    { tag: `runtime_scene_scan_scale_${name}`, fallback: null, logger: print }
  ) as { x?: number; y?: number; z?: number } | null
  if (scale === null || scale === undefined || scale.x === undefined || scale.y === undefined || scale.z === undefined) {
    print(`[${TERRAIN_TAG}] scene scan skipped name=${name} reason=missing_scale`)
    return null
  }
  return { x: scale.x, y: scale.y, z: scale.z }
}

function queryRoot(): unknown {
  return safeCall(
    () => {
      return (LuaAPI as any).query_unit(SCENE_ROOT_NAME)
    },
    { tag: "runtime_scene_scan_root", fallback: null, logger: print }
  )
}

function getChildren(unit: unknown): unknown[] {
  const children = safeCall(
    () => {
      const target = unit as any
      if (target.get_children === undefined || target.get_children === null) {
        return []
      }
      return target.get_children()
    },
    { tag: "runtime_scene_scan_children", fallback: [], logger: print }
  ) as unknown[] | null
  return children === null ? [] : children
}

function getUnitIdentity(unit: unknown): string {
  const id = safeCall(
    () => {
      return (LuaAPI as any).get_unit_id(unit)
    },
    { tag: "runtime_scene_scan_unit_id", fallback: null, logger: print }
  )
  return id === null || id === undefined ? tostring(unit) : tostring(id)
}

function readRuntimeSceneUnit(unit: unknown): RuntimeSceneUnit | null {
  const role = readStringKv(unit, ROLE_KEY) as RuntimeSceneRole | undefined
  if (role === undefined) {
    return null
  }
  const runtimeNameKv = readStringKv(unit, "QRRuntimeName")
  const runtimeName = runtimeNameKv === undefined ? getUnitIdentity(unit) : runtimeNameKv
  const componentKv = readStringKv(unit, "QRComponent")
  const component = componentKv === undefined ? runtimeName : componentKv
  const module = readNumberKv(unit, "QRModule")
  const position = getUnitPosition(unit, runtimeName)
  const scale = getUnitScale(unit, runtimeName)
  if (module === undefined || position === null || scale === null) {
    print(`[${TERRAIN_TAG}] scene scan skipped name=${runtimeName} role=${role} reason=missing_required_kv_or_transform`)
    return null
  }
  return {
    unit,
    role,
    runtimeName,
    component,
    module,
    x: position.x,
    y: position.y,
    z: position.z,
    sx: scale.x,
    sy: scale.y,
    sz: scale.z,
    moveZ: readNumberKv(unit, "QRMoveZ"),
    moving: readBoolKv(unit, "QRMoving"),
  }
}

export function scanQuickRunnerRuntimeScene(): RuntimeSceneUnit[] {
  const root = queryRoot()
  if (root === null || root === undefined) {
    print(`[${TERRAIN_TAG}] scene scan failed root_missing=${SCENE_ROOT_NAME}`)
    return []
  }

  const out: RuntimeSceneUnit[] = []
  const pending: unknown[] = [root]
  const visited: Record<string, boolean> = {}
  while (pending.length > 0) {
    const unit = pending.pop()!
    const identity = getUnitIdentity(unit)
    if (visited[identity] === true) {
      continue
    }
    visited[identity] = true

    const runtimeUnit = readRuntimeSceneUnit(unit)
    if (runtimeUnit !== null) {
      out.push(runtimeUnit)
    }

    const children = getChildren(unit)
    for (let i = 0; i < children.length; i++) {
      pending.push(children[i]!)
    }
  }

  print(`[${TERRAIN_TAG}] scene scan complete units=${out.length}`)
  return out
}
