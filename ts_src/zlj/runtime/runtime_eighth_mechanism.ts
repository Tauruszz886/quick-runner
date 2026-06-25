import { safeCall, safeCreateCustomTriggerSpace } from "@common/engine_safe"
import { EventBus } from "@common/event_bus"
import { TriggerHub } from "@common/trigger_hub"
import {
  EIGHTH_LEVEL_FIXED_HIGH_BAR_HEIGHT,
  EIGHTH_LEVEL_MECHANISM_CENTER_RAISE_Y,
  EIGHTH_LEVEL_MECHANISM_MOVE_FRAMES,
  EIGHTH_LEVEL_MECHANISM_MOVE_SECONDS,
  EIGHTH_LEVEL_MECHANISM_MOVE_Z,
  EIGHTH_LEVEL_MECHANISM_SPLIT_Z,
  EIGHTH_LEVEL_MOVING_LONG_PLATE_EXTRA_RAISE_Y,
  EIGHTH_LEVEL_SMALL_CROSSBAR_EXTRA_RAISE_Y,
  EIGHTH_LEVEL_TERRAIN_MODULE_INDEX,
  FIRST_LEVEL_TERRAIN_HEIGHT,
  type RuntimeTerrainPiece,
} from "../config"
import { eliminateUnitAndRebirthAtBirth } from "../birth/rebirth"
import { asFixed } from "../layout"
import { GAME_EVENTS } from "./GameEvents"

const DEATH_TRIGGER_PREFAB_ID = 3101010
const DEATH_TRIGGER_OUTSET = 0.2

type RuntimeEighthMechanismPart = {
  name: string
  unit: unknown
  trigger?: unknown
  x: number
  y: number
  z: number
  targetZ: number
}

declare const EVENT: {
  ANY_LIFEENTITY_TRIGGER_SPACE: string
}
declare const Enums: { TriggerSpaceEventType: { ENTER: number } }

let runtimeEighthMechanismStarted = false
let runtimeEighthMechanismParts: RuntimeEighthMechanismPart[] = []
let runtimeEighthMechanismGeneration = 0

export function resetEighthLevelMechanism(): void {
  runtimeEighthMechanismParts = []
  runtimeEighthMechanismStarted = false
}

function isEighthLevelSmallCrossbar(piece: RuntimeTerrainPiece): boolean {
  return piece.sx === 0.5 && piece.sz === 4
}

function isEighthLevelMovingLongPlate(piece: RuntimeTerrainPiece): boolean {
  return (piece.sx === 35 || piece.sx === 27.5) && piece.sy === 5 && piece.sz === 4
}

function isEighthLevelFixedHighBar(piece: RuntimeTerrainPiece): boolean {
  return piece.sx === 112 && piece.sy === EIGHTH_LEVEL_FIXED_HIGH_BAR_HEIGHT && piece.sz === 4
}

export function getRuntimeTerrainPieceY(moduleIndex: number, piece: RuntimeTerrainPiece, defaultY: number): number {
  const y = piece.baseY === undefined ? defaultY : piece.baseY
  if (moduleIndex !== EIGHTH_LEVEL_TERRAIN_MODULE_INDEX) {
    return y
  }
  if (isEighthLevelFixedHighBar(piece)) {
    return y + FIRST_LEVEL_TERRAIN_HEIGHT
  }
  if (isEighthLevelSmallCrossbar(piece)) {
    return y + EIGHTH_LEVEL_MECHANISM_CENTER_RAISE_Y + EIGHTH_LEVEL_SMALL_CROSSBAR_EXTRA_RAISE_Y
  }
  if (isEighthLevelMovingLongPlate(piece)) {
    return y + EIGHTH_LEVEL_MECHANISM_CENTER_RAISE_Y + EIGHTH_LEVEL_MOVING_LONG_PLATE_EXTRA_RAISE_Y
  }
  return y
}

function getEighthLevelMechanismTargetZ(piece: RuntimeTerrainPiece, z: number): number | undefined {
  const isSmallCrossbar = isEighthLevelSmallCrossbar(piece)
  const isLongPlate = isEighthLevelMovingLongPlate(piece)
  if (!isSmallCrossbar && !isLongPlate) {
    return undefined
  }
  const moveZ = piece.startZ < EIGHTH_LEVEL_MECHANISM_SPLIT_Z ? -EIGHTH_LEVEL_MECHANISM_MOVE_Z : EIGHTH_LEVEL_MECHANISM_MOVE_Z
  return z + moveZ
}

export function isEighthLevelMechanismPiece(moduleIndex: number, piece: RuntimeTerrainPiece): boolean {
  return moduleIndex === EIGHTH_LEVEL_TERRAIN_MODULE_INDEX && getEighthLevelMechanismTargetZ(piece, 0) !== undefined
}

function vec3(x: number, y: number, z: number): unknown {
  return math.Vector3(asFixed(x), asFixed(y), asFixed(z))
}

function extractTriggerUnit(data: unknown): unknown {
  const eventData = data as { event_unit?: unknown; unit?: unknown } | undefined
  return eventData?.event_unit !== undefined ? eventData.event_unit : eventData?.unit
}

function createEighthDeathTrigger(name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number): unknown {
  const trigger = safeCreateCustomTriggerSpace(
    DEATH_TRIGGER_PREFAB_ID,
    vec3(x, y, z),
    vec3(sx + DEATH_TRIGGER_OUTSET * 2, sy + DEATH_TRIGGER_OUTSET * 2, sz + DEATH_TRIGGER_OUTSET * 2),
    { tag: `eighth_death_trigger_create_${name}`, logger: print }
  )
  if (trigger === null || trigger === undefined) {
    print(`[ZLJ_EIGHTH_MECHANISM] death trigger create failed name=${name}`)
    return undefined
  }
  const triggerId = safeCall(
    () => {
      return (trigger as any).get_id()
    },
    { tag: `eighth_death_trigger_id_${name}`, fallback: null, logger: print }
  )
  if (triggerId !== null && triggerId !== undefined) {
    TriggerHub.register(
      [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
      (_eventName: unknown, _actor: unknown, data: unknown) => {
        eliminateUnitAndRebirthAtBirth(extractTriggerUnit(data), `eighth_mechanism:${name}:${tostring(triggerId)}`)
      },
      { safe: true, safeCallback: true, tag: `eighth_death_trigger_${name}`, logger: print }
    )
  }
  print(
    `[ZLJ_EIGHTH_MECHANISM] death trigger created name=${name} trigger=${tostring(trigger)} id=${tostring(triggerId)} pos=(${x},${y},${z}) scale=(${sx + DEATH_TRIGGER_OUTSET * 2},${sy + DEATH_TRIGGER_OUTSET * 2},${sz + DEATH_TRIGGER_OUTSET * 2}) enabled_by_global=false`
  )
  return trigger
}

export function registerEighthLevelMechanismPart(
  moduleIndex: number,
  piece: RuntimeTerrainPiece,
  unit: unknown,
  name: string,
  x: number,
  y: number,
  z: number
): void {
  if (!isEighthLevelMechanismPiece(moduleIndex, piece) || unit === null || unit === undefined) {
    return
  }
  const targetZ = getEighthLevelMechanismTargetZ(piece, z)
  if (targetZ === undefined) {
    return
  }
  const trigger = createEighthDeathTrigger(name, x, y, z, piece.sx, piece.sy, piece.sz)
  runtimeEighthMechanismParts.push({ name, unit, trigger, x, y, z, targetZ })
  print(
    `[ZLJ_EIGHTH_MECHANISM] registered name=${name} start=(${x},${y},${z}) target_z=${targetZ} move_z=${targetZ - z} move_seconds=${EIGHTH_LEVEL_MECHANISM_MOVE_SECONDS}`
  )
}

export function registerEighthLevelMechanismBinding(
  unit: unknown,
  name: string,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  moveZ: number
): void {
  if (unit === null || unit === undefined) {
    return
  }
  const targetZ = z + moveZ
  const trigger = createEighthDeathTrigger(name, x, y, z, sx, sy, sz)
  runtimeEighthMechanismParts.push({ name, unit, trigger, x, y, z, targetZ })
  print(
    `[ZLJ_EIGHTH_MECHANISM] registered name=${name} source=runtime_scene_binding start=(${x},${y},${z}) target_z=${targetZ} move_z=${moveZ} move_seconds=${EIGHTH_LEVEL_MECHANISM_MOVE_SECONDS}`
  )
}

function setEighthLevelMechanismPartPosition(part: RuntimeEighthMechanismPart, z: number): void {
  safeCall(
    () => {
      ;(part.unit as any).set_position(math.Vector3(part.x as Fixed, part.y as Fixed, z as Fixed))
    },
    { tag: `eighth_mechanism_set_position_${part.name}`, fallback: undefined, logger: print }
  )
  if (part.trigger !== undefined && part.trigger !== null) {
    safeCall(
      () => {
        ;(part.trigger as any).set_position(math.Vector3(part.x as Fixed, part.y as Fixed, z as Fixed))
      },
      { tag: `eighth_mechanism_set_trigger_position_${part.name}`, fallback: undefined, logger: print }
    )
  }
}

function animateEighthLevelMechanism(toTarget: boolean, done?: () => void): void {
  if (runtimeEighthMechanismParts.length === 0) {
    if (done !== undefined) {
      done()
    }
    return
  }
  let frame = 0
  const generation = runtimeEighthMechanismGeneration
  const step = (): void => {
    if (generation !== runtimeEighthMechanismGeneration) {
      return
    }
    frame += 1
    const t = frame / EIGHTH_LEVEL_MECHANISM_MOVE_FRAMES
    for (let i = 0; i < runtimeEighthMechanismParts.length; i++) {
      const part = runtimeEighthMechanismParts[i]!
      const fromZ = toTarget ? part.z : part.targetZ
      const toZ = toTarget ? part.targetZ : part.z
      setEighthLevelMechanismPartPosition(part, fromZ + (toZ - fromZ) * t)
    }
    if (frame < EIGHTH_LEVEL_MECHANISM_MOVE_FRAMES) {
      ;(LuaAPI as any).call_delay_frame(1, step)
      return
    }
    if (done !== undefined) {
      done()
    }
  }
  step()
}

function scheduleEighthLevelMechanismCycle(toTarget: boolean): void {
  animateEighthLevelMechanism(toTarget, () => {
    scheduleEighthLevelMechanismCycle(!toTarget)
  })
}

export function startEighthLevelMechanism(): void {
  if (runtimeEighthMechanismStarted) {
    return
  }
  runtimeEighthMechanismStarted = true
  if (runtimeEighthMechanismParts.length === 0) {
    print("[ZLJ_EIGHTH_MECHANISM] skipped parts=0")
    return
  }
  print(
    `[ZLJ_EIGHTH_MECHANISM] start parts=${runtimeEighthMechanismParts.length} groups=4 visible_crossbars_per_group=6 distance=${EIGHTH_LEVEL_MECHANISM_MOVE_Z} seconds=${EIGHTH_LEVEL_MECHANISM_MOVE_SECONDS} axis=Z`
  )
  scheduleEighthLevelMechanismCycle(true)
}

function resetEighthLevelMechanismToInitial(source: string): void {
  if (runtimeEighthMechanismParts.length === 0) {
    return
  }
  runtimeEighthMechanismGeneration += 1
  for (let i = 0; i < runtimeEighthMechanismParts.length; i++) {
    const part = runtimeEighthMechanismParts[i]!
    setEighthLevelMechanismPartPosition(part, part.z)
  }
  runtimeEighthMechanismStarted = false
  print(
    `[ZLJ_EIGHTH_MECHANISM] reset_to_initial source=${source} parts=${runtimeEighthMechanismParts.length} generation=${runtimeEighthMechanismGeneration}`
  )
  startEighthLevelMechanism()
}

EventBus.on(GAME_EVENTS.PLAYER_DIED_TO_REBIRTH, (_unit: unknown, source: unknown) => {
  resetEighthLevelMechanismToInitial(tostring(source))
})
