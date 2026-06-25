import { safeCall } from "@common/engine_safe"
import { TriggerHub } from "@common/trigger_hub"
import { FALL_DEATH_ZONES } from "../levels/fall_death_zones"
import type { FallDeathZoneSpec } from "../levels/shared/types"
import { RUNTIME_FLOOR } from "../config"
import { getRuntimeFloorForModule, getRuntimeModuleCenterX } from "../layout"
import { eliminateUnitAndRebirthAtBirth } from "../birth/rebirth"

const TAG = "ZLJ_HOLE_DEATH"
const BIG_FLOOR_TOP_Y = 3
const WALKABLE_TOP_Y = 6.5
const TRIGGER_BOTTOM_Y = BIG_FLOOR_TOP_Y + 0.05
const TRIGGER_TOP_Y = WALKABLE_TOP_Y - 0.8
export const HOLE_DEATH_TRIGGER_CENTER_Y = (TRIGGER_BOTTOM_Y + TRIGGER_TOP_Y) / 2
export const HOLE_DEATH_TRIGGER_HEIGHT = TRIGGER_TOP_Y - TRIGGER_BOTTOM_Y

type PositionScale = {
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
}

declare const EVENT: {
  ANY_LIFEENTITY_TRIGGER_SPACE: string
}
declare const Enums: { TriggerSpaceEventType: { ENTER: number } }

let created = false

function handleTriggerData(data: unknown, source: string): void {
  const eventData = data as { event_unit?: unknown; unit?: unknown } | undefined
  eliminateUnitAndRebirthAtBirth(eventData?.event_unit !== undefined ? eventData.event_unit : eventData?.unit, source)
}

function editorModuleLabel(moduleIndex: number): string {
  return moduleIndex === 0 ? "出生地" : `第${moduleIndex < 10 ? "0" : ""}${moduleIndex}关`
}

function editorZoneUnitName(zone: FallDeathZoneSpec): string {
  return `QR_${editorModuleLabel(zone.module)}_掉坑死亡_${zone.name}`
}

function expectedZoneTransform(zone: FallDeathZoneSpec): PositionScale {
  const frame = getRuntimeFloorForModule(zone.module)
  const moduleCenterX = getRuntimeModuleCenterX(zone.module)
  const minX = moduleCenterX - frame.sx / 2
  const minZ = RUNTIME_FLOOR.z - frame.sz / 2
  return {
    x: minX + zone.startX + zone.sx / 2,
    y: HOLE_DEATH_TRIGGER_CENTER_Y,
    z: minZ + zone.startZ + zone.sz / 2,
    sx: zone.sx,
    sy: HOLE_DEATH_TRIGGER_HEIGHT,
    sz: zone.sz,
  }
}

function queryEditorUnit(name: string): unknown {
  return safeCall(
    () => {
      return (LuaAPI as any).query_unit(name)
    },
    { tag: `hole_death_query_${name}`, fallback: null, logger: print }
  )
}

function registerReturnTrigger(trigger: unknown, name: string): boolean {
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] trigger register skipped name=${name} trigger=nil`)
    return false
  }
  const triggerId = safeCall(
    () => {
      return (trigger as any).get_id()
    },
    { tag: `hole_death_trigger_id_${name}`, fallback: null, logger: print }
  )
  if (triggerId === null || triggerId === undefined) {
    print(`[${TAG}] trigger register skipped name=${name} trigger_id=nil`)
    return false
  }
  TriggerHub.register(
    [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
    (_eventName: unknown, _actor: unknown, data: unknown) => handleTriggerData(data, `scene:${name}:${tostring(triggerId)}`),
    { safe: true, safeCallback: true, tag: `hole_death_scene_${name}`, logger: print }
  )
  print(`[${TAG}] trigger registered name=${name} trigger=${tostring(trigger)} id=${tostring(triggerId)}`)
  return true
}

export function createHoleDeathTriggers(): void {
  if (created) {
    return
  }
  created = true

  let registered = 0
  let missing = 0
  for (let i = 0; i < FALL_DEATH_ZONES.length; i++) {
    const zone = FALL_DEATH_ZONES[i]!
    const name = editorZoneUnitName(zone)
    const unit = queryEditorUnit(name)
    const expected = expectedZoneTransform(zone)
    if (unit === null || unit === undefined) {
      missing += 1
      print(
        `[${TAG}] scene trigger missing name=${name} expected_pos=(${expected.x},${expected.y},${expected.z}) expected_scale=(${expected.sx},${expected.sy},${expected.sz})`
      )
      continue
    }
    if (registerReturnTrigger(unit, name)) {
      registered += 1
    }
  }

  print(
    `[${TAG}] scene trigger bind complete total=${FALL_DEATH_ZONES.length} registered=${registered} missing=${missing} source=data/zlj/fall_death_zones.json`
  )
}

export function createFallReturnTriggers(): void {
  createHoleDeathTriggers()
}
