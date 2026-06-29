import { safeCall } from "@common/engine_safe"
import { EventBus } from "@common/event_bus"
import { TriggerHub } from "@common/trigger_hub"
import {
  EIGHTH_LEVEL_FIXED_HIGH_BAR_HEIGHT,
  EIGHTH_LEVEL_MECHANISM_CENTER_RAISE_Y,
  EIGHTH_LEVEL_MECHANISM_MOVE_FRAMES,
  EIGHTH_LEVEL_MECHANISM_MOVE_Z,
  EIGHTH_LEVEL_MECHANISM_SPLIT_Z,
  EIGHTH_LEVEL_MOVING_LONG_PLATE_EXTRA_RAISE_Y,
  EIGHTH_LEVEL_SMALL_CROSSBAR_EXTRA_RAISE_Y,
  EIGHTH_LEVEL_TERRAIN_MODULE_INDEX,
  FIRST_LEVEL_TERRAIN_HEIGHT,
  type RuntimeTerrainPiece,
} from "../config"
import { eliminateUnitAndRebirthAtBirth } from "../birth/rebirth"
import { GAME_EVENTS } from "./GameEvents"

type RuntimeEighthMechanismPart = {
  name: string
  unit: unknown
  trigger?: unknown
  x: number
  y: number
  z: number
  targetZ: number
}

type PendingEighthMechanismDeathTrigger = {
  trigger: unknown
  triggerName: string
  targetRuntimeName: string
}

declare const EVENT: {
  ANY_LIFEENTITY_TRIGGER_SPACE: string
}
declare const Enums: { TriggerSpaceEventType: { ENTER: number } }

let runtimeEighthMechanismStarted = false
let runtimeEighthMechanismParts: RuntimeEighthMechanismPart[] = []
let runtimeEighthMechanismPartsByName: Record<string, RuntimeEighthMechanismPart> = {}
let pendingEighthMechanismDeathTriggers: PendingEighthMechanismDeathTrigger[] = []
let runtimeEighthMechanismGeneration = 0
let runtimeEighthMechanismTriggerBoundCount = 0
let runtimeEighthMechanismCycleLogCount = 0
let runtimeEighthMechanismPendingLogCount = 0

export function resetEighthLevelMechanism(): void {
  runtimeEighthMechanismParts = []
  runtimeEighthMechanismPartsByName = {}
  pendingEighthMechanismDeathTriggers = []
  runtimeEighthMechanismStarted = false
  runtimeEighthMechanismTriggerBoundCount = 0
  runtimeEighthMechanismCycleLogCount = 0
  runtimeEighthMechanismPendingLogCount = 0
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

function extractTriggerUnit(data: unknown): unknown {
  const eventData = data as { event_unit?: unknown; unit?: unknown } | undefined
  return eventData?.event_unit !== undefined ? eventData.event_unit : eventData?.unit
}

function registerEighthDeathEvent(part: RuntimeEighthMechanismPart, trigger: unknown, triggerName: string): void {
  const triggerId = safeCall(
    () => {
      return (trigger as any).get_id()
    },
    { tag: `eighth_death_trigger_id_${part.name}`, fallback: null, logger: print }
  )
  if (triggerId === null || triggerId === undefined) {
    print(`[ZLJ_EIGHTH_MECHANISM] death trigger register skipped name=${part.name} trigger_name=${triggerName} trigger_id=nil`)
    return
  }
  TriggerHub.register(
    [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
    (_eventName: unknown, _actor: unknown, data: unknown) => {
      eliminateUnitAndRebirthAtBirth(extractTriggerUnit(data), `eighth_mechanism:${part.name}:${tostring(triggerId)}`)
    },
    { safe: true, safeCallback: true, tag: `eighth_death_trigger_${part.name}`, logger: print }
  )
}

function bindEighthDeathTrigger(part: RuntimeEighthMechanismPart, trigger: unknown, triggerName: string): void {
  part.trigger = trigger
  runtimeEighthMechanismTriggerBoundCount += 1
  registerEighthDeathEvent(part, trigger, triggerName)
}

function attachPendingEighthDeathTriggers(part: RuntimeEighthMechanismPart): void {
  if (pendingEighthMechanismDeathTriggers.length === 0) {
    return
  }
  const remaining: PendingEighthMechanismDeathTrigger[] = []
  for (let i = 0; i < pendingEighthMechanismDeathTriggers.length; i++) {
    const pending = pendingEighthMechanismDeathTriggers[i]!
    if (pending.targetRuntimeName === part.name) {
      bindEighthDeathTrigger(part, pending.trigger, pending.triggerName)
    } else {
      remaining.push(pending)
    }
  }
  pendingEighthMechanismDeathTriggers = remaining
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
  const part = { name, unit, x, y, z, targetZ }
  runtimeEighthMechanismParts.push(part)
  runtimeEighthMechanismPartsByName[name] = part
  if (runtimeEighthMechanismParts.length <= 3) {
    print(`[ZLJ_EIGHTH_MECHANISM] part registered name=${name} from=(${x},${y},${z}) targetZ=${targetZ}`)
  }
  attachPendingEighthDeathTriggers(part)
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
  const part = { name, unit, x, y, z, targetZ }
  runtimeEighthMechanismParts.push(part)
  runtimeEighthMechanismPartsByName[name] = part
  if (runtimeEighthMechanismParts.length <= 3) {
    print(`[ZLJ_EIGHTH_MECHANISM] part registered name=${name} from=(${x},${y},${z}) targetZ=${targetZ}`)
  }
  attachPendingEighthDeathTriggers(part)
}

export function registerEighthLevelMechanismDeathTriggerUnit(trigger: unknown, triggerName: string, targetRuntimeName: string): boolean {
  if (trigger === null || trigger === undefined) {
    print(`[ZLJ_EIGHTH_MECHANISM] death trigger skipped name=${triggerName} target=${targetRuntimeName} trigger=nil`)
    return false
  }
  const part = runtimeEighthMechanismPartsByName[targetRuntimeName]
  if (part === undefined) {
    pendingEighthMechanismDeathTriggers.push({ trigger, triggerName, targetRuntimeName })
    if (runtimeEighthMechanismPendingLogCount < 3) {
      print(`[ZLJ_EIGHTH_MECHANISM] death trigger pending name=${triggerName} target=${targetRuntimeName}`)
      runtimeEighthMechanismPendingLogCount += 1
    }
    return true
  }
  bindEighthDeathTrigger(part, trigger, triggerName)
  return true
}

function setEighthLevelMechanismPartPosition(part: RuntimeEighthMechanismPart, z: number): void {
  safeCall(
    () => {
      ;(part.unit as any).set_position(math.Vector3(part.x as Fixed, part.y as Fixed, z as Fixed))
    },
    { tag: `eighth_mechanism_set_position_${part.name}`, fallback: undefined, logger: print }
  )
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
  if (runtimeEighthMechanismCycleLogCount < 2) {
    print(`[ZLJ_EIGHTH_MECHANISM] phase start direction=${toTarget ? "to_target" : "to_origin"} frames=${EIGHTH_LEVEL_MECHANISM_MOVE_FRAMES} parts=${runtimeEighthMechanismParts.length}`)
  }
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
    if (runtimeEighthMechanismCycleLogCount < 2) {
      const sample = runtimeEighthMechanismParts[0]
      if (sample !== undefined) {
        print(`[ZLJ_EIGHTH_MECHANISM] phase complete direction=${toTarget ? "to_target" : "to_origin"} sample=${sample.name}`)
      } else {
        print(`[ZLJ_EIGHTH_MECHANISM] phase complete direction=${toTarget ? "to_target" : "to_origin"}`)
      }
      runtimeEighthMechanismCycleLogCount += 1
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
    `[ZLJ_EIGHTH_MECHANISM] start parts=${runtimeEighthMechanismParts.length} death_triggers_bound=${runtimeEighthMechanismTriggerBoundCount} pending_triggers=${pendingEighthMechanismDeathTriggers.length}`
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
  startEighthLevelMechanism()
}

EventBus.on(GAME_EVENTS.PLAYER_DIED_TO_REBIRTH, (_unit: unknown, source: unknown) => {
  resetEighthLevelMechanismToInitial(tostring(source))
})
