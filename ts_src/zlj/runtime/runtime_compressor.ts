import { safeCall, safeCreateCustomTriggerSpace } from "@common/engine_safe"
import { EventBus } from "@common/event_bus"
import { TriggerHub } from "@common/trigger_hub"
import {
  FOURTH_LEVEL_COMPRESSOR_DOWN_SECONDS,
  FOURTH_LEVEL_COMPRESSOR_DOWN_STEPS,
  FOURTH_LEVEL_COMPRESSOR_DOWN_Y,
  FOURTH_LEVEL_COMPRESSOR_HEIGHT,
  FOURTH_LEVEL_COMPRESSOR_HOLD_SECONDS,
  FOURTH_LEVEL_COMPRESSOR_START_Y,
  FOURTH_LEVEL_COMPRESSOR_UP_FRAMES,
  FOURTH_LEVEL_COMPRESSOR_WAIT_SECONDS,
  FOURTH_LEVEL_PRESS_PLATE_FLOAT_GAP,
} from "../config"
import { eliminateUnitAndRebirthAtBirth } from "../birth/rebirth"
import { asFixed } from "../layout"
import { GAME_EVENTS } from "./GameEvents"

const TAG = "ZLJ_RUNTIME_COMPRESSOR"
const DEATH_TRIGGER_PREFAB_ID = 3101010
const DEATH_TRIGGER_OUTSET = 0.25

type RuntimeCompressorPiece = {
  name: string
  unit: unknown
  trigger?: unknown
  x: number
  z: number
  sx: number
  sy: number
  sz: number
  upY: number
  downY: number
}

declare const EVENT: {
  ANY_LIFEENTITY_TRIGGER_SPACE: string
}
declare const Enums: { TriggerSpaceEventType: { ENTER: number } }

let runtimeCompressorStarted = false
let runtimeCompressorPieces: RuntimeCompressorPiece[] = []
let compressorCycleGeneration = 0

export function resetRuntimeCompressors(): void {
  runtimeCompressorPieces = []
  runtimeCompressorStarted = false
}

export function registerRuntimeCompressorPiece(piece: RuntimeCompressorPiece): void {
  createRuntimeCompressorDeathTrigger(piece)
  runtimeCompressorPieces.push(piece)
}

function vec3(x: number, y: number, z: number): unknown {
  return math.Vector3(asFixed(x), asFixed(y), asFixed(z))
}

function extractTriggerUnit(data: unknown): unknown {
  const eventData = data as { event_unit?: unknown; unit?: unknown } | undefined
  return eventData?.event_unit !== undefined ? eventData.event_unit : eventData?.unit
}

function registerRuntimeCompressorDeathEvent(piece: RuntimeCompressorPiece): void {
  if (piece.trigger === undefined || piece.trigger === null) {
    return
  }
  const triggerId = safeCall(
    () => {
      return (piece.trigger as any).get_id()
    },
    { tag: `runtime_compressor_death_trigger_id_${piece.name}`, fallback: null, logger: print }
  )
  if (triggerId === null || triggerId === undefined) {
    print(`[${TAG}] death trigger register skipped name=${piece.name} trigger_id=nil`)
    return
  }
  TriggerHub.register(
    [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
    (_eventName: unknown, _actor: unknown, data: unknown) => {
      eliminateUnitAndRebirthAtBirth(extractTriggerUnit(data), `compressor:${piece.name}:${tostring(triggerId)}`)
    },
    {
      safe: true,
      safeCallback: true,
      tag: `runtime_compressor_death_${piece.name}`,
      logger: print,
    }
  )
  print(`[${TAG}] death trigger registered name=${piece.name} trigger=${tostring(piece.trigger)} id=${tostring(triggerId)}`)
}

function createRuntimeCompressorDeathTrigger(piece: RuntimeCompressorPiece): void {
  const trigger = safeCreateCustomTriggerSpace(
    DEATH_TRIGGER_PREFAB_ID,
    vec3(piece.x, piece.upY, piece.z),
    vec3(piece.sx + DEATH_TRIGGER_OUTSET * 2, piece.sy + DEATH_TRIGGER_OUTSET * 2, piece.sz + DEATH_TRIGGER_OUTSET * 2),
    { tag: `runtime_compressor_death_trigger_create_${piece.name}`, logger: print }
  )
  if (trigger === null) {
    print(`[${TAG}] death trigger create failed name=${piece.name}`)
    return
  }
  piece.trigger = trigger
  registerRuntimeCompressorDeathEvent(piece)
  print(
    `[${TAG}] death trigger created name=${piece.name} prefab=${DEATH_TRIGGER_PREFAB_ID} pos=(${piece.x},${piece.upY},${piece.z}) scale=(${piece.sx + DEATH_TRIGGER_OUTSET * 2},${piece.sy + DEATH_TRIGGER_OUTSET * 2},${piece.sz + DEATH_TRIGGER_OUTSET * 2})`
  )
}

function setRuntimeCompressorPosition(piece: RuntimeCompressorPiece, y: number): void {
  safeCall(
    () => {
      ;(piece.unit as any).set_position(math.Vector3(piece.x as Fixed, y as Fixed, piece.z as Fixed))
    },
    { tag: `runtime_compressor_set_position_${piece.name}`, fallback: undefined, logger: print }
  )
  if (piece.trigger !== undefined && piece.trigger !== null) {
    safeCall(
      () => {
        ;(piece.trigger as any).set_position(math.Vector3(piece.x as Fixed, y as Fixed, piece.z as Fixed))
      },
      { tag: `runtime_compressor_set_trigger_position_${piece.name}`, fallback: undefined, logger: print }
    )
  }
}

function animateRuntimeCompressorPiece(piece: RuntimeCompressorPiece, fromY: number, toY: number, frames: number, done?: () => void): void {
  let frame = 0
  const generation = compressorCycleGeneration
  const step = (): void => {
    if (generation !== compressorCycleGeneration) {
      return
    }
    frame += 1
    const t = frame / frames
    setRuntimeCompressorPosition(piece, fromY + (toY - fromY) * t)
    if (frame < frames) {
      ;(LuaAPI as any).call_delay_frame(1, step)
      return
    }
    if (done !== undefined) {
      done()
    }
  }
  step()
}

function animateRuntimeCompressorPieceBySeconds(
  piece: RuntimeCompressorPiece,
  fromY: number,
  toY: number,
  seconds: number,
  steps: number,
  done?: () => void
): void {
  let stepIndex = 0
  const generation = compressorCycleGeneration
  const stepSeconds = seconds / steps
  const step = (): void => {
    if (generation !== compressorCycleGeneration) {
      return
    }
    stepIndex += 1
    const t = stepIndex / steps
    setRuntimeCompressorPosition(piece, fromY + (toY - fromY) * t)
    if (stepIndex < steps) {
      ;(LuaAPI as any).call_delay_time(asFixed(stepSeconds), step)
      return
    }
    if (done !== undefined) {
      done()
    }
  }
  step()
}

function animateRuntimeCompressors(direction: "drop" | "rise", frames: number, done?: () => void): void {
  if (runtimeCompressorPieces.length === 0) {
    if (done !== undefined) {
      done()
    }
    return
  }
  let remaining = runtimeCompressorPieces.length
  for (let i = 0; i < runtimeCompressorPieces.length; i++) {
    const piece = runtimeCompressorPieces[i]!
    const fromY = direction === "drop" ? piece.upY : piece.downY
    const toY = direction === "drop" ? piece.downY : piece.upY
    animateRuntimeCompressorPiece(piece, fromY, toY, frames, () => {
      remaining -= 1
      if (remaining <= 0 && done !== undefined) {
        done()
      }
    })
  }
}

function animateRuntimeCompressorsDrop(done?: () => void): void {
  if (runtimeCompressorPieces.length === 0) {
    if (done !== undefined) {
      done()
    }
    return
  }
  let remaining = runtimeCompressorPieces.length
  for (let i = 0; i < runtimeCompressorPieces.length; i++) {
    const piece = runtimeCompressorPieces[i]!
    animateRuntimeCompressorPieceBySeconds(
      piece,
      piece.upY,
      piece.downY,
      FOURTH_LEVEL_COMPRESSOR_DOWN_SECONDS,
      FOURTH_LEVEL_COMPRESSOR_DOWN_STEPS,
      () => {
        remaining -= 1
        if (remaining <= 0 && done !== undefined) {
          done()
        }
      }
    )
  }
}

function scheduleRuntimeCompressorCycle(): void {
  const generation = compressorCycleGeneration
  ;(LuaAPI as any).call_delay_time(asFixed(FOURTH_LEVEL_COMPRESSOR_WAIT_SECONDS), () => {
    if (generation !== compressorCycleGeneration) {
      return
    }
    animateRuntimeCompressorsDrop(() => {
      ;(LuaAPI as any).call_delay_time(asFixed(FOURTH_LEVEL_COMPRESSOR_HOLD_SECONDS), () => {
        if (generation !== compressorCycleGeneration) {
          return
        }
        animateRuntimeCompressors("rise", FOURTH_LEVEL_COMPRESSOR_UP_FRAMES, scheduleRuntimeCompressorCycle)
      })
    })
  })
}

export function startRuntimeCompressors(): void {
  if (runtimeCompressorStarted) {
    return
  }
  runtimeCompressorStarted = true
  if (runtimeCompressorPieces.length === 0) {
    print(`[${TAG}] skipped pieces=0`)
    return
  }
  print(
    `[${TAG}] start pieces=${runtimeCompressorPieces.length} plate_up_y=${FOURTH_LEVEL_COMPRESSOR_START_Y} plate_down_y=${FOURTH_LEVEL_COMPRESSOR_DOWN_Y} float_gap=${FOURTH_LEVEL_PRESS_PLATE_FLOAT_GAP} plate_height=${FOURTH_LEVEL_COMPRESSOR_HEIGHT} cycle_wait=${FOURTH_LEVEL_COMPRESSOR_WAIT_SECONDS} drop_seconds=${FOURTH_LEVEL_COMPRESSOR_DOWN_SECONDS} hold_seconds=${FOURTH_LEVEL_COMPRESSOR_HOLD_SECONDS}`
  )
  scheduleRuntimeCompressorCycle()
}

function resetRuntimeCompressorsToInitial(source: string): void {
  if (runtimeCompressorPieces.length === 0) {
    return
  }
  compressorCycleGeneration += 1
  for (let i = 0; i < runtimeCompressorPieces.length; i++) {
    const piece = runtimeCompressorPieces[i]!
    setRuntimeCompressorPosition(piece, piece.upY)
  }
  runtimeCompressorStarted = false
  print(`[${TAG}] reset_to_initial source=${source} pieces=${runtimeCompressorPieces.length} generation=${compressorCycleGeneration}`)
  startRuntimeCompressors()
}

EventBus.on(GAME_EVENTS.PLAYER_DIED_TO_REBIRTH, (_unit: unknown, source: unknown) => {
  resetRuntimeCompressorsToInitial(tostring(source))
})
