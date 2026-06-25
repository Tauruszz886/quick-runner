import { safeCall, safeCreateCustomTriggerSpace } from "@common/engine_safe"
import { TriggerHub } from "@common/trigger_hub"
import { LEVEL_TERRAIN_SPECS, type LevelTerrainSpec } from "../levels/terrain"
import {
  RUNTIME_FLOOR,
  type RuntimeFloor,
} from "../config"
import { asFixed, getRuntimeFloorForModule, getRuntimeModuleCenterX, runtimeModuleLabel } from "../layout"
import { eliminateUnitAndRebirthAtBirth } from "../birth/rebirth"

const TAG = "ZLJ_HOLE_DEATH"
const TRIGGER_PREFAB_ID = 3101010
const FIRST_LEVEL_INDEX = 1
const LAST_LEVEL_INDEX = 10
const BIG_FLOOR_TOP_Y = 3
const WALKABLE_TOP_Y = 6.5
const TRIGGER_BOTTOM_Y = BIG_FLOOR_TOP_Y + 0.05
const TRIGGER_TOP_Y = WALKABLE_TOP_Y - 0.8
export const HOLE_DEATH_TRIGGER_CENTER_Y = (TRIGGER_BOTTOM_Y + TRIGGER_TOP_Y) / 2
export const HOLE_DEATH_TRIGGER_HEIGHT = TRIGGER_TOP_Y - TRIGGER_BOTTOM_Y
const CREATE_BATCH_SIZE = 12
const MIN_RECT_SIZE = 0.05

type Rect = {
  startX: number
  startZ: number
  sx: number
  sz: number
}

type FallTriggerPart = Rect & {
  moduleIndex: number
}

declare const EVENT: {
  TIMEOUT: string
  ANY_LIFEENTITY_TRIGGER_SPACE: string
}
declare const Enums: { TriggerSpaceEventType: { ENTER: number } }

let created = false

function vec3(x: number, y: number, z: number): unknown {
  return math.Vector3(asFixed(x), asFixed(y), asFixed(z))
}

function pushUnique(values: number[], value: number): void {
  for (let i = 0; i < values.length; i++) {
    if (math.abs(values[i]! - value) < 0.0001) {
      return
    }
  }
  values.push(value)
}

function sortNumbers(values: number[]): void {
  values.sort((a, b) => a - b)
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return math.max(minValue, math.min(maxValue, value))
}

function createEdges(frame: RuntimeFloor, specs: readonly LevelTerrainSpec[]): { xs: number[]; zs: number[] } {
  const xs: number[] = [0, frame.sx]
  const zs: number[] = [0, frame.sz]
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!
    pushUnique(xs, clamp(spec.startX, 0, frame.sx))
    pushUnique(xs, clamp(spec.startX + spec.sx, 0, frame.sx))
    pushUnique(zs, clamp(spec.startZ, 0, frame.sz))
    pushUnique(zs, clamp(spec.startZ + spec.sz, 0, frame.sz))
  }
  sortNumbers(xs)
  sortNumbers(zs)
  return { xs, zs }
}

function rectContainsPoint(spec: LevelTerrainSpec, x: number, z: number): boolean {
  return x >= spec.startX && x <= spec.startX + spec.sx && z >= spec.startZ && z <= spec.startZ + spec.sz
}

function isCoveredByTerrain(specs: readonly LevelTerrainSpec[], x: number, z: number): boolean {
  for (let i = 0; i < specs.length; i++) {
    if (rectContainsPoint(specs[i]!, x, z)) {
      return true
    }
  }
  return false
}

function makeKey(rect: Rect): string {
  return `${rect.startX}:${rect.sx}`
}

function mergeVertical(rects: Rect[]): Rect[] {
  const merged: Rect[] = []
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]!
    let extended = false
    for (let j = 0; j < merged.length; j++) {
      const target = merged[j]!
      if (makeKey(target) === makeKey(rect) && math.abs(target.startZ + target.sz - rect.startZ) < 0.0001) {
        target.sz += rect.sz
        extended = true
        break
      }
    }
    if (!extended) {
      merged.push({ startX: rect.startX, startZ: rect.startZ, sx: rect.sx, sz: rect.sz })
    }
  }
  return merged
}

function computeHoleRects(frame: RuntimeFloor, specs: readonly LevelTerrainSpec[]): Rect[] {
  const edges = createEdges(frame, specs)
  const rowRects: Rect[] = []
  for (let zi = 0; zi < edges.zs.length - 1; zi++) {
    const z0 = edges.zs[zi]!
    const z1 = edges.zs[zi + 1]!
    if (z1 - z0 <= MIN_RECT_SIZE) {
      continue
    }
    let activeStartX: number | undefined
    for (let xi = 0; xi < edges.xs.length - 1; xi++) {
      const x0 = edges.xs[xi]!
      const x1 = edges.xs[xi + 1]!
      if (x1 - x0 <= MIN_RECT_SIZE) {
        continue
      }
      const centerX = (x0 + x1) / 2
      const centerZ = (z0 + z1) / 2
      const isHole = !isCoveredByTerrain(specs, centerX, centerZ)
      if (isHole && activeStartX === undefined) {
        activeStartX = x0
      }
      if ((!isHole || xi === edges.xs.length - 2) && activeStartX !== undefined) {
        const endX = isHole && xi === edges.xs.length - 2 ? x1 : x0
        if (endX - activeStartX > MIN_RECT_SIZE) {
          rowRects.push({ startX: activeStartX, startZ: z0, sx: endX - activeStartX, sz: z1 - z0 })
        }
        activeStartX = undefined
      }
    }
  }
  return mergeVertical(rowRects)
}

function handleTriggerData(data: unknown, source: string): void {
  const eventData = data as { event_unit?: unknown; unit?: unknown } | undefined
  eliminateUnitAndRebirthAtBirth(eventData?.event_unit !== undefined ? eventData.event_unit : eventData?.unit, source)
}

function registerReturnTrigger(trigger: unknown, name: string): void {
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] trigger register skipped name=${name} trigger=nil`)
    return
  }
  const triggerId = safeCall(
    () => {
      return (trigger as any).get_id()
    },
    { tag: `hole_death_trigger_id_${name}`, fallback: null, logger: print }
  )
  if (triggerId !== null && triggerId !== undefined) {
    TriggerHub.register(
      [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
      (_eventName: unknown, _actor: unknown, data: unknown) => handleTriggerData(data, `global:${name}:${tostring(triggerId)}`),
      { safe: true, safeCallback: true, tag: `hole_death_global_${name}`, logger: print }
    )
  }
  print(`[${TAG}] trigger registered name=${name} trigger=${tostring(trigger)} id=${tostring(triggerId)}`)
}

function createTrigger(part: FallTriggerPart): void {
  const frame = getRuntimeFloorForModule(part.moduleIndex)
  const moduleCenterX = getRuntimeModuleCenterX(part.moduleIndex)
  const minX = moduleCenterX - frame.sx / 2
  const minZ = RUNTIME_FLOOR.z - frame.sz / 2
  const x = minX + part.startX + part.sx / 2
  const z = minZ + part.startZ + part.sz / 2
  const name = `${runtimeModuleLabel(part.moduleIndex)}_空洞死亡_${part.startX}_${part.startZ}`
  const trigger = safeCreateCustomTriggerSpace(
    TRIGGER_PREFAB_ID,
    vec3(x, HOLE_DEATH_TRIGGER_CENTER_Y, z),
    vec3(part.sx, HOLE_DEATH_TRIGGER_HEIGHT, part.sz),
    { tag: `hole_death_create_${name}`, logger: print }
  )
  registerReturnTrigger(trigger, name)
  print(
    `[${TAG}] created name=${name} trigger=${tostring(trigger)} pos=(${x},${HOLE_DEATH_TRIGGER_CENTER_Y},${z}) scale=(${part.sx},${HOLE_DEATH_TRIGGER_HEIGHT},${part.sz}) x_range=${minX + part.startX}..${minX + part.startX + part.sx} z_range=${minZ + part.startZ}..${minZ + part.startZ + part.sz}`
  )
}

export function createHoleDeathTriggers(): void {
  if (created) {
    return
  }
  created = true

  const parts: FallTriggerPart[] = []
  for (let moduleIndex = FIRST_LEVEL_INDEX; moduleIndex <= LAST_LEVEL_INDEX; moduleIndex++) {
    const specs = LEVEL_TERRAIN_SPECS[moduleIndex]
    if (specs === undefined) {
      continue
    }
    const frame = getRuntimeFloorForModule(moduleIndex)
    const holes = computeHoleRects(frame, specs)
    for (let i = 0; i < holes.length; i++) {
      const hole = holes[i]!
      parts.push({ moduleIndex, startX: hole.startX, startZ: hole.startZ, sx: hole.sx, sz: hole.sz })
    }
    print(`[${TAG}] holes module=${runtimeModuleLabel(moduleIndex)} count=${holes.length} frame=(${frame.sx},${frame.sz})`)
  }

  print(
    `[${TAG}] create begin triggers=${parts.length} modules=${FIRST_LEVEL_INDEX}..${LAST_LEVEL_INDEX} prefab=${TRIGGER_PREFAB_ID} y=${TRIGGER_BOTTOM_Y}..${TRIGGER_TOP_Y} action=die_to_birth_rebirth`
  )
  let index = 0
  const createBatch = (): void => {
    let createdThisFrame = 0
    while (index < parts.length && createdThisFrame < CREATE_BATCH_SIZE) {
      createTrigger(parts[index]!)
      index += 1
      createdThisFrame += 1
    }
    if (index < parts.length) {
      ;(LuaAPI as any).call_delay_frame(1, createBatch)
      return
    }
    print(`[${TAG}] create complete triggers=${parts.length}`)
  }
  createBatch()
}

export function createFallReturnTriggers(): void {
  createHoleDeathTriggers()
}
