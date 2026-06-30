import { safeCall, safeQueryUnitsByPrefabId } from "@common/engine_safe"
import { toNumber } from "@common/num"
import { TERRAIN_TAG } from "../config"

export type RuntimeSceneRole =
  | "first_victory_coin_trigger"
  | "second_chaser_surface"
  | "third_timed_platform"
  | "third_vanishing_platform"
  | "third_vanishing_trigger"
  | "fourth_compressor"
  | "fourth_compressor_death_trigger"
  | "eighth_moving_part"
  | "eighth_moving_death_trigger"
  | "ninth_vanishing_platform"
  | "ninth_vanishing_trigger"
  | "ninth_vanishing_death_trigger"
  | "tenth_current"
  | "tenth_current_group"
  | "tenth_current_trigger"
  | "tenth_victory_trigger"
  | "scene_root"
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
  moveSeconds?: number
  touchDeath?: boolean
  targetRuntimeName?: string
  finishGame?: boolean
  coinReward?: number
  respawnAtBirth?: boolean
}

const SCENE_ROOT_NAME = "QR_地图_ROOT"
const ROLE_KEY = "QRRole"
const RUNTIME_TRIGGER_PREFAB_ID = 3101010
const RUNTIME_FLOOR_OBSTACLE_PREFAB_ID = 105205
const RUNTIME_CURRENT_OBSTACLE_PREFAB_ID = 3301506

const FALLBACK_QUERY_SPECS = [
  { prefabId: RUNTIME_TRIGGER_PREFAB_ID, label: "custom_trigger" },
  { prefabId: RUNTIME_FLOOR_OBSTACLE_PREFAB_ID, label: "floor_obstacle" },
  { prefabId: RUNTIME_CURRENT_OBSTACLE_PREFAB_ID, label: "current_obstacle" },
] as const

function readKv(unit: unknown, valueType: Enums.ValueType, key: string): unknown {
  return safeCall(
    () => {
      const target = unit as any
      if (target.has_kv !== undefined && target.has_kv !== null && target.has_kv(key) !== true) {
        return null
      }
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
  return value === null || value === undefined ? undefined : toNumber(value, { mode: "loose", ctx: key, logger: print })
}

function readBoolKv(unit: unknown, key: string): boolean | undefined {
  const value = readKv(unit, Enums.ValueType.Bool, key)
  return typeof value === "boolean" ? value : undefined
}

function readIntKv(unit: unknown, key: string): number | undefined {
  const value = readKv(unit, Enums.ValueType.Int, key)
  if (typeof value === "number") {
    return value
  }
  const strValue = readKv(unit, Enums.ValueType.Str, key)
  return strValue === null || strValue === undefined ? undefined : toNumber(strValue, { mode: "loose", ctx: key, logger: print })
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

function appendRuntimeSceneUnit(out: RuntimeSceneUnit[], visited: Record<string, boolean>, unit: unknown): void {
  const identity = getUnitIdentity(unit)
  if (visited[identity] === true) {
    return
  }
  visited[identity] = true

  const runtimeUnit = readRuntimeSceneUnit(unit)
  if (runtimeUnit !== null) {
    out.push(runtimeUnit)
  }
}

function appendQueryableRuntimeUnits(out: RuntimeSceneUnit[], visited: Record<string, boolean>): { candidates: number; added: number } {
  const before = out.length
  let candidates = 0
  for (let specIndex = 0; specIndex < FALLBACK_QUERY_SPECS.length; specIndex++) {
    const spec = FALLBACK_QUERY_SPECS[specIndex]!
    const units = safeQueryUnitsByPrefabId(spec.prefabId)
    candidates += units.length
    for (let i = 0; i < units.length; i++) {
      appendRuntimeSceneUnit(out, visited, units[i]!)
    }
  }
  return { candidates, added: out.length - before }
}

function scanQueryableRuntimeTriggerUnits(reason: string): RuntimeSceneUnit[] {
  const out: RuntimeSceneUnit[] = []
  const visited: Record<string, boolean> = {}
  const result = appendQueryableRuntimeUnits(out, visited)
  print(`[${TERRAIN_TAG}] scene scan fallback reason=${reason} candidates=${result.candidates} runtime_units=${out.length}`)
  return out
}

function printRoleSummary(units: RuntimeSceneUnit[], source: string): void {
  const counts: Record<string, number> = {}
  for (let i = 0; i < units.length; i++) {
    const role = units[i]!.role
    counts[role] = (counts[role] === undefined ? 0 : counts[role]!) + 1
  }
  const parts: string[] = []
  for (const role in counts) {
    parts.push(`${role}=${counts[role]}`)
  }
  print(`[${TERRAIN_TAG}] scene scan roles source=${source} ${parts.join(",")}`)
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
  if (role === "scene_root") {
    return null
  }
  const runtimeNameKv = readStringKv(unit, "QRRuntimeName")
  const runtimeName = runtimeNameKv === undefined ? getUnitIdentity(unit) : runtimeNameKv
  const componentKv = readStringKv(unit, "QRComponent")
  const component = componentKv === undefined ? runtimeName : componentKv
  const module = readIntKv(unit, "QRModule")
  const position = getUnitPosition(unit, runtimeName)
  const scale = getUnitScale(unit, runtimeName)
  if (module === undefined || position === null || scale === null) {
    print(`[${TERRAIN_TAG}] scene scan skipped name=${runtimeName} role=${role} reason=missing_required_kv_or_transform`)
    return null
  }
  const item: RuntimeSceneUnit = {
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
  }
  if (role === "fourth_compressor") {
    item.moveSeconds = readNumberKv(unit, "QRMoveSeconds")
  }
  if (role === "fourth_compressor_death_trigger" || role === "eighth_moving_death_trigger") {
    item.touchDeath = readBoolKv(unit, "QRTouchDeath")
    item.targetRuntimeName = readStringKv(unit, "QRTargetRuntimeName")
  }
  if (
    role === "third_vanishing_trigger" ||
    role === "ninth_vanishing_trigger" ||
    role === "ninth_vanishing_death_trigger" ||
    role === "tenth_current_trigger"
  ) {
    item.targetRuntimeName = readStringKv(unit, "QRTargetRuntimeName")
  }
  if (role === "tenth_current" || role === "tenth_current_trigger") {
    item.moving = readBoolKv(unit, "QRMoving")
  }
  if (role === "tenth_victory_trigger") {
    item.finishGame = readBoolKv(unit, "QRFinishGame")
  }
  if (role === "first_victory_coin_trigger") {
    item.coinReward = readIntKv(unit, "QRCoins")
    item.respawnAtBirth = readBoolKv(unit, "QRRespawnAtBirth")
  }
  return item
}

export function scanQuickRunnerRuntimeScene(): RuntimeSceneUnit[] {
  const root = queryRoot()
  if (root === null || root === undefined) {
    print(`[${TERRAIN_TAG}] scene scan failed root_missing=${SCENE_ROOT_NAME}`)
    return scanQueryableRuntimeTriggerUnits("root_missing")
  }

  const out: RuntimeSceneUnit[] = []
  const pending: unknown[] = [root]
  const visited: Record<string, boolean> = {}
  while (pending.length > 0) {
    const unit = pending.pop()!
    appendRuntimeSceneUnit(out, visited, unit)

    const children = getChildren(unit)
    for (let i = 0; i < children.length; i++) {
      pending.push(children[i]!)
    }
  }

  const supplement = appendQueryableRuntimeUnits(out, visited)
  print(
    `[${TERRAIN_TAG}] scene scan root_found=${SCENE_ROOT_NAME} root_units=${out.length - supplement.added} supplement_candidates=${supplement.candidates} supplement_added=${supplement.added} runtime_units=${out.length}`
  )
  printRoleSummary(out, "root_plus_prefab")
  if (out.length === 0) {
    return scanQueryableRuntimeTriggerUnits("root_empty")
  }
  return out
}
