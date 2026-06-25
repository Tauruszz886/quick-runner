import { safeCall, safeCreateCustomTriggerSpace } from "@common/engine_safe"
import { EventBus } from "@common/event_bus"
import { TriggerHub } from "@common/trigger_hub"
import { TENTH_LEVEL_TERRAIN_MODULE_INDEX, type RuntimeTerrainPiece } from "../config"
import { eliminateUnitAndRebirthAtBirth } from "../birth/rebirth"
import { asFixed } from "../layout"
import { GAME_EVENTS } from "./GameEvents"

const TAG = "ZLJ_TENTH_CURRENT"
const CURRENT_PREFAB_ID = 3301506
const DEATH_TRIGGER_PREFAB_ID = 3101010
const MOVING_SOURCE_PREFIX = "dxf_97B_"
const SURFACE_SECONDS = 2
const HIDDEN_RETURN_SECONDS = 2
const PHASE_STEPS = 40
const STEP_SECONDS = SURFACE_SECONDS / PHASE_STEPS
const MOVE_DISTANCE_X = 113.4
const HIDDEN_Y = 2.5
const DEATH_TRIGGER_OUTSET = 0.25
const DEATH_TRIGGER_CREATE_BATCH_SIZE = 8

type TenthCurrentPart = {
  name: string
  unit: unknown
  deathTrigger?: unknown
  moving: boolean
  startX: number
  surfaceY: number
  z: number
  sx: number
  sy: number
  sz: number
  endX: number
}

declare const EVENT: {
  ANY_LIFEENTITY_TRIGGER_SPACE: string
}
declare const Enums: { TriggerSpaceEventType: { ENTER: number } }

let started = false
let parts: TenthCurrentPart[] = []
let movingParts: TenthCurrentPart[] = []
let cycleGeneration = 0

export function resetTenthCurrentMechanism(): void {
  started = false
  parts = []
  movingParts = []
}

function isCurrentPiece(piece: RuntimeTerrainPiece): boolean {
  return piece.prefabId === CURRENT_PREFAB_ID
}

export function isTenthCurrentPiece(moduleIndex: number, piece: RuntimeTerrainPiece): boolean {
  return moduleIndex === TENTH_LEVEL_TERRAIN_MODULE_INDEX && isCurrentPiece(piece)
}

function isMovingCurrentPiece(piece: RuntimeTerrainPiece): boolean {
  return isCurrentPiece(piece) && piece.name.indexOf(MOVING_SOURCE_PREFIX) === 0
}

function vec3(x: number, y: number, z: number): unknown {
  return math.Vector3(asFixed(x), asFixed(y), asFixed(z))
}

function extractTriggerUnit(data: unknown): unknown {
  const eventData = data as { event_unit?: unknown; unit?: unknown } | undefined
  return eventData?.event_unit !== undefined ? eventData.event_unit : eventData?.unit
}

function createCurrentDeathTrigger(part: TenthCurrentPart): unknown {
  return safeCreateCustomTriggerSpace(
    DEATH_TRIGGER_PREFAB_ID,
    vec3(part.startX, part.surfaceY, part.z),
    vec3(part.sx + DEATH_TRIGGER_OUTSET * 2, part.sy + DEATH_TRIGGER_OUTSET * 2, part.sz + DEATH_TRIGGER_OUTSET * 2),
    { tag: `tenth_current_death_trigger_create_${part.name}`, logger: print }
  )
}

function registerCurrentDeathEvent(part: TenthCurrentPart): void {
  const trigger = createCurrentDeathTrigger(part)
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] death trigger create failed name=${part.name}`)
    return
  }
  part.deathTrigger = trigger
  const triggerId = safeCall(
    () => {
      return (trigger as any).get_id()
    },
    { tag: `tenth_current_trigger_id_${part.name}`, fallback: null, logger: print }
  )
  if (triggerId === null || triggerId === undefined) {
    print(`[${TAG}] death trigger skipped name=${part.name} trigger_id=nil`)
    return
  }
  TriggerHub.register(
    [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
    (_eventName: unknown, _actor: unknown, data: unknown) => {
      eliminateUnitAndRebirthAtBirth(extractTriggerUnit(data), `tenth_current:${part.name}:${tostring(triggerId)}`)
    },
    {
      safe: true,
      safeCallback: true,
      tag: `tenth_current_death_${part.name}`,
      logger: print,
    }
  )
  print(
    `[${TAG}] death trigger registered name=${part.name} trigger=${tostring(trigger)} id=${tostring(triggerId)} pos=(${part.startX},${part.surfaceY},${part.z}) scale=(${part.sx + DEATH_TRIGGER_OUTSET * 2},${part.sy + DEATH_TRIGGER_OUTSET * 2},${part.sz + DEATH_TRIGGER_OUTSET * 2}) moving=${part.moving}`
  )
}

export function registerTenthCurrentPart(
  moduleIndex: number,
  piece: RuntimeTerrainPiece,
  unit: unknown,
  name: string,
  x: number,
  y: number,
  z: number
): void {
  if (!isTenthCurrentPiece(moduleIndex, piece) || unit === null || unit === undefined) {
    return
  }
  const moving = isMovingCurrentPiece(piece)
  const part: TenthCurrentPart = {
    name,
    unit,
    moving,
    startX: x,
    surfaceY: y,
    z,
    sx: piece.sx,
    sy: piece.sy,
    sz: piece.sz,
    endX: x - MOVE_DISTANCE_X,
  }
  parts.push(part)
  if (moving) {
    movingParts.push(part)
  }
  print(
    `[${TAG}] registered name=${name} start=(${x},${y},${z}) end_x=${part.endX} hidden_y=${HIDDEN_Y} moving=${moving} death_trigger=pending cycle_seconds=${SURFACE_SECONDS + HIDDEN_RETURN_SECONDS}`
  )
}

export function registerTenthCurrentBinding(
  unit: unknown,
  name: string,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  moving: boolean
): void {
  if (unit === null || unit === undefined) {
    return
  }
  const part: TenthCurrentPart = {
    name,
    unit,
    moving,
    startX: x,
    surfaceY: y,
    z,
    sx,
    sy,
    sz,
    endX: x - MOVE_DISTANCE_X,
  }
  parts.push(part)
  if (moving) {
    movingParts.push(part)
  }
  print(
    `[${TAG}] registered name=${name} source=runtime_scene_binding start=(${x},${y},${z}) end_x=${part.endX} hidden_y=${HIDDEN_Y} moving=${moving} death_trigger=pending cycle_seconds=${SURFACE_SECONDS + HIDDEN_RETURN_SECONDS}`
  )
}

function setPartPosition(part: TenthCurrentPart, x: number, y: number): void {
  safeCall(
    () => {
      ;(part.unit as any).set_position(vec3(x, y, part.z))
    },
    { tag: `tenth_current_set_position_${part.name}`, fallback: undefined, logger: print }
  )
  if (part.deathTrigger !== undefined && part.deathTrigger !== null) {
    safeCall(
      () => {
        ;(part.deathTrigger as any).set_position(vec3(x, y, part.z))
      },
      { tag: `tenth_current_set_death_trigger_position_${part.name}`, fallback: undefined, logger: print }
    )
  }
}

function setAllPartsAtSurfaceStart(): void {
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    setPartPosition(part, part.startX, part.surfaceY)
  }
}

function setAllPartsAtHiddenEnd(): void {
  for (let i = 0; i < movingParts.length; i++) {
    const part = movingParts[i]!
    setPartPosition(part, part.endX, HIDDEN_Y)
  }
}

function animatePhase(surfaceForward: boolean, done: () => void): void {
  let step = 0
  const generation = cycleGeneration
  const tick = (): void => {
    if (generation !== cycleGeneration) {
      return
    }
    step += 1
    const t = step / PHASE_STEPS
    for (let i = 0; i < movingParts.length; i++) {
      const part = movingParts[i]!
      const fromX = surfaceForward ? part.startX : part.endX
      const toX = surfaceForward ? part.endX : part.startX
      const y = surfaceForward ? part.surfaceY : HIDDEN_Y
      setPartPosition(part, fromX + (toX - fromX) * t, y)
    }
    if (step < PHASE_STEPS) {
      ;(LuaAPI as any).call_delay_time(asFixed(STEP_SECONDS), tick)
      return
    }
    done()
  }
  tick()
}

function runCycle(): void {
  animatePhase(true, () => {
    setAllPartsAtHiddenEnd()
    animatePhase(false, () => {
      setAllPartsAtSurfaceStart()
      runCycle()
    })
  })
}

function createDeathTriggersBatched(done: () => void): void {
  let index = 0
  const createBatch = (): void => {
    let createdThisFrame = 0
    while (index < parts.length && createdThisFrame < DEATH_TRIGGER_CREATE_BATCH_SIZE) {
      const part = parts[index]!
      if (part.deathTrigger === undefined || part.deathTrigger === null) {
        registerCurrentDeathEvent(part)
        createdThisFrame += 1
      }
      index += 1
    }
    if (index < parts.length) {
      ;(LuaAPI as any).call_delay_frame(1, createBatch)
      return
    }
    print(`[${TAG}] death trigger batch complete all_parts=${parts.length} moving_parts=${movingParts.length}`)
    done()
  }
  ;(LuaAPI as any).call_delay_frame(1, createBatch)
}

export function startTenthCurrentMechanism(): void {
  if (started) {
    return
  }
  started = true
  if (movingParts.length === 0) {
    print(`[${TAG}] skipped moving_parts=0 all_parts=${parts.length}`)
    return
  }
  print(
    `[${TAG}] start moving_parts=${movingParts.length} all_parts=${parts.length} moving_prefix=${MOVING_SOURCE_PREFIX} cycle_seconds=${SURFACE_SECONDS + HIDDEN_RETURN_SECONDS} surface_seconds=${SURFACE_SECONDS} hidden_return_seconds=${HIDDEN_RETURN_SECONDS} move_distance_x=${MOVE_DISTANCE_X} hidden_y=${HIDDEN_Y}`
  )
  createDeathTriggersBatched(() => {
    setAllPartsAtSurfaceStart()
    runCycle()
  })
}

function resetTenthCurrentToInitial(source: string): void {
  if (parts.length === 0) {
    return
  }
  cycleGeneration += 1
  setAllPartsAtSurfaceStart()
  started = false
  print(`[${TAG}] reset_to_initial source=${source} moving_parts=${movingParts.length} all_parts=${parts.length} generation=${cycleGeneration}`)
  startTenthCurrentMechanism()
}

EventBus.on(GAME_EVENTS.PLAYER_DIED_TO_REBIRTH, (_unit: unknown, source: unknown) => {
  resetTenthCurrentToInitial(tostring(source))
})

export function printTenthCurrentDebugSummary(source: string): void {
  const first = parts[0]
  if (first === undefined) {
    print(`[${TAG}] debug source=${source} started=${started} parts=0`)
    return
  }
  print(
    `[${TAG}] debug source=${source} started=${started} moving_parts=${movingParts.length} all_parts=${parts.length} first=${first.name} start=(${first.startX},${first.surfaceY},${first.z}) end_x=${first.endX} hidden_y=${HIDDEN_Y}`
  )
}
