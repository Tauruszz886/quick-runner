import { safeCall, safeCreateCustomTriggerSpace, safeCreateObstacle, safeQueryUnitsByPrefabId } from "@common/engine_safe"
import { TriggerHub } from "@common/trigger_hub"
import { eliminateUnitAndRebirthAtBirth } from "../birth/rebirth"

const TAG = "ZLJ_RUNTIME_MIDDLE_LAYER"
const LAYER_PREFAB_ID = 105205
const HAZARD_TRIGGER_PREFAB_ID = 3101010
const LAYER_COLOR = 0xff0000 as Color
const LAYER_SY = 0.1
const TRIGGER_SY = 0.1
const MIDDLE_CHANNEL_CENTER_Y = 5
const MIDDLE_CHANNEL_SY = 3
const CHANNEL_BOTTOM_Y = MIDDLE_CHANNEL_CENTER_Y - MIDDLE_CHANNEL_SY / 2
const CHANNEL_TOP_Y = MIDDLE_CHANNEL_CENTER_Y + MIDDLE_CHANNEL_SY / 2
const CHANNEL_LAYER_TOP_DOWN_Y = 3.1
const CHANNEL_LAYER_TOP_UP_Y = CHANNEL_TOP_Y
const CHANNEL_MOVE_DISTANCE = CHANNEL_LAYER_TOP_UP_Y - CHANNEL_LAYER_TOP_DOWN_Y
// 夹层中心由顶面反推；初始藏在大地板和地砖的 0.5 缝隙内，2.5 秒上移到玩家行走面。
const CHANNEL_DOWN_Y = CHANNEL_LAYER_TOP_DOWN_Y - LAYER_SY / 2
const CHANNEL_UP_Y = CHANNEL_LAYER_TOP_UP_Y - LAYER_SY / 2
const GAP_DOWN_Y = CHANNEL_DOWN_Y
const GAP_UP_Y = CHANNEL_UP_Y
const MOVE_SECONDS = 1
const MOVE_FRAMES = 30
const UP_HOLD_SECONDS = 2
const DOWN_HOLD_SECONDS = 0.4
const PAINT_AREAS = [1, 2, 3, 4] as const

export const FIFTH_MIDDLE_LAYER_CREATE_DELAY_SECONDS = 3.5

type RuntimeFloor = {
  z: number
  sx: number
  sz: number
}

type MiddleLayerSpec = {
  name: string
  startX: number
  startZ: number
  sx: number
  sz: number
  channel?: boolean
}

type MiddleLayerPart = {
  name: string
  unit: unknown
  trigger: unknown
  x: number
  z: number
  downY: number
  upY: number
}

type CreateOptions = {
  floor: RuntimeFloor
  moduleCenterX: number
  moduleLabel: string
}

type Position3 = {
  x: number
  y: number
  z: number
}

declare function print(v: unknown): void
declare function tostring(v: unknown): string
declare const EVENT: {
  TIMEOUT: string
  ANY_LIFEENTITY_TRIGGER_SPACE: string
}
declare const Enums: {
  TriggerSpaceEventType: { ENTER: number }
  UnitType: { OBSTACLE: unknown }
}
declare const LuaAPI: unknown
declare const math: unknown

const SPECS: readonly MiddleLayerSpec[] = [
  { name: "夹层A", startX: 0, startZ: 0, sx: 16, sz: 31.25 },
  { name: "夹层B", startX: 0, startZ: 68.75, sx: 16, sz: 31.25 },
  { name: "夹层C_中间通道连接", startX: 16, startZ: 0, sx: 128, sz: 100, channel: true },
  { name: "夹层D", startX: 144, startZ: 0, sx: 16, sz: 12.5 },
  { name: "夹层E", startX: 144, startZ: 87.5, sx: 16, sz: 12.5 },
]

let created = false
let moving = false
let parts: MiddleLayerPart[] = []

function fixed(v: number): Fixed {
  return (v + 0.1 - 0.1) as Fixed
}

function vec3(x: number, y: number, z: number): unknown {
  return (math as any).Vector3(fixed(x), fixed(y), fixed(z))
}

function triggerY(layerY: number): number {
  return layerY + LAYER_SY / 2 + TRIGGER_SY / 2
}

function specDownY(spec: MiddleLayerSpec): number {
  return spec.channel === true ? CHANNEL_DOWN_Y : GAP_DOWN_Y
}

function specUpY(spec: MiddleLayerSpec): number {
  return spec.channel === true ? CHANNEL_UP_Y : GAP_UP_Y
}

function editorUnitName(moduleLabel: string, specName: string): string {
  return `QR_${moduleLabel}_${specName}`
}

function queryEditorUnit(name: string): unknown {
  const unit = safeCall(
    () => {
      return (LuaAPI as any).query_unit(name)
    },
    { tag: `middle_layer_query_${name}`, fallback: null, logger: print }
  )
  if (unit === null || unit === undefined) {
    print(`[${TAG}] editor unit missing name=${name}`)
    return null
  }
  return unit
}

function queryMiddleLayerCandidates(): unknown[] {
  return safeQueryUnitsByPrefabId(LAYER_PREFAB_ID)
}

function getUnitPosition(unit: unknown, fallback: Position3, name: string): Position3 {
  const pos = safeCall(
    () => {
      return (unit as any).get_position()
    },
    { tag: `middle_layer_position_${name}`, fallback: null, logger: print }
  ) as { x?: number; y?: number; z?: number } | null
  if (pos === null || pos === undefined || pos.x === undefined || pos.y === undefined || pos.z === undefined) {
    return fallback
  }
  return {
    x: pos.x,
    y: pos.y,
    z: pos.z,
  }
}

function positionDistance(a: Position3, b: Position3): number {
  return (math as any).abs(a.x - b.x) + (math as any).abs(a.y - b.y) + (math as any).abs(a.z - b.z)
}

function queryEditorUnitByPosition(name: string, fallback: Position3): unknown {
  const candidates = queryMiddleLayerCandidates()
  let bestUnit: unknown = null
  let bestDistance = 999999
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!
    const pos = getUnitPosition(candidate, fallback, `${name}_candidate_${i + 1}`)
    const distance = positionDistance(pos, fallback)
    if (distance < bestDistance) {
      bestDistance = distance
      bestUnit = candidate
    }
  }
  if (bestUnit !== null && bestDistance <= 0.25) {
    return bestUnit
  }
  print(`[${TAG}] editor unit position missing name=${name} candidates=${candidates.length} best_distance=${bestDistance}`)
  return null
}

function queryEditorUnitByNameOrPosition(name: string, fallback: Position3): unknown {
  const unit = queryEditorUnit(name)
  if (unit !== null && unit !== undefined) {
    return unit
  }
  return queryEditorUnitByPosition(name, fallback)
}

function createRuntimeMiddleLayerUnit(name: string, fallback: Position3, spec: MiddleLayerSpec): unknown {
  const unit = safeCreateObstacle(
    LAYER_PREFAB_ID,
    vec3(fallback.x, fallback.y, fallback.z),
    vec3(spec.sx, LAYER_SY, spec.sz),
    { tag: `middle_layer_runtime_fallback_create_${name}`, logger: print }
  )
  return unit
}

function setPartY(part: MiddleLayerPart, y: number): void {
  safeCall(
    () => {
      ;(part.unit as any).set_position(vec3(part.x, y, part.z))
    },
    { tag: `middle_layer_set_${part.name}`, fallback: undefined, logger: print }
  )
  if (part.trigger !== null && part.trigger !== undefined) {
    safeCall(
      () => {
        ;(part.trigger as any).set_position(vec3(part.x, triggerY(y), part.z))
      },
      { tag: `middle_layer_trigger_set_${part.name}`, fallback: undefined, logger: print }
    )
  }
}

function applyLayerColor(unit: unknown, name: string): void {
  if (unit === null || unit === undefined) {
    return
  }
  for (let i = 0; i < PAINT_AREAS.length; i++) {
    const area = PAINT_AREAS[i]! as PaintArea
    safeCall(
      () => {
        const target = unit as any
        if (target.set_paint_area_color !== undefined && target.set_paint_area_color !== null) {
          target.set_paint_area_color(area, LAYER_COLOR)
        }
      },
      { tag: `middle_layer_color_${name}_${i + 1}`, fallback: undefined, logger: print }
    )
  }
}

function animate(toUp: boolean, done?: () => void): void {
  if (parts.length === 0) {
    if (done !== undefined) done()
    return
  }
  let frame = 0
  const stepSeconds = MOVE_SECONDS / MOVE_FRAMES
  const step = (): void => {
    frame += 1
    const t = frame / MOVE_FRAMES
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const fromY = toUp ? part.downY : part.upY
      const toY = toUp ? part.upY : part.downY
      setPartY(part, fromY + (toY - fromY) * t)
    }
    if (frame < MOVE_FRAMES) {
      ;(LuaAPI as any).call_delay_time(fixed(stepSeconds), step)
      return
    }
    if (done !== undefined) done()
  }
  step()
}

function cycle(toUp: boolean): void {
  const holdSeconds = toUp ? UP_HOLD_SECONDS : DOWN_HOLD_SECONDS
  animate(toUp, () => {
    ;(LuaAPI as any).call_delay_time(fixed(holdSeconds), () => cycle(!toUp))
  })
}

function startMove(moduleLabel: string): void {
  if (moving) return
  moving = true
  if (parts.length === 0) {
    print(`[${TAG}] move skipped parts=0`)
    return
  }
  cycle(true)
}

function eliminateToBirthRebirth(unit: unknown, source: string): void {
  eliminateUnitAndRebirthAtBirth(unit, `middle_layer:${source}`)
}

function handleTriggerData(data: unknown, source: string): void {
  const eventData = data as { event_unit?: unknown; unit?: unknown } | undefined
  eliminateToBirthRebirth(eventData?.event_unit !== undefined ? eventData.event_unit : eventData?.unit, source)
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
    { tag: `middle_layer_trigger_id_${name}`, fallback: null, logger: print }
  )
  if (triggerId !== null && triggerId !== undefined) {
    TriggerHub.register(
      [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
      (_eventName: unknown, _actor: unknown, data: unknown) => handleTriggerData(data, `global:${name}:${tostring(triggerId)}`),
      { safe: true, safeCallback: true, tag: `middle_layer_hazard_${name}`, logger: print }
    )
  }
}

export function createFifthMiddleLayer(options: CreateOptions): void {
  if (created) return
  created = true
  moving = false
  parts = []

  const moduleMinX = options.moduleCenterX - options.floor.sx / 2
  const moduleMinZ = options.floor.z - options.floor.sz / 2
  let bound = 0
  let missing = 0
  let fallbackCreated = 0
  for (let i = 0; i < SPECS.length; i++) {
    const spec = SPECS[i]!
    const fallbackDownY = specDownY(spec)
    const fallbackUpY = specUpY(spec)
    const fallbackX = moduleMinX + spec.startX + spec.sx / 2
    const fallbackZ = moduleMinZ + spec.startZ + spec.sz / 2
    const name = `${options.moduleLabel}_${spec.name}`
    const editorName = editorUnitName(options.moduleLabel, spec.name)
    const fallback = { x: fallbackX, y: fallbackDownY, z: fallbackZ }
    let unit = queryEditorUnitByNameOrPosition(editorName, fallback)
    if (unit === null || unit === undefined) {
      unit = createRuntimeMiddleLayerUnit(name, fallback, spec)
      if (unit !== null && unit !== undefined) {
        fallbackCreated += 1
      }
    }
    if (unit === null || unit === undefined) {
      missing += 1
      continue
    }
    const pos = getUnitPosition(unit, fallback, editorName)
    const x = pos.x
    const z = pos.z
    const downY = pos.y
    const upY = pos.y + (fallbackUpY - fallbackDownY)
    const trigger = safeCreateCustomTriggerSpace(
      HAZARD_TRIGGER_PREFAB_ID,
      vec3(x, triggerY(downY), z),
      vec3(spec.sx, TRIGGER_SY, spec.sz),
      { tag: `middle_layer_trigger_create_${name}`, logger: print }
    )
    applyLayerColor(unit, name)
    registerReturnTrigger(trigger, name)
    parts.push({ name, unit, trigger, x, z, downY, upY })
    bound += 1
  }
  startMove(options.moduleLabel)
}
