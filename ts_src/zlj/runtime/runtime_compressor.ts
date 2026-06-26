import { safeCall } from "@common/engine_safe"
import { EventBus } from "@common/event_bus"
import { TriggerHub } from "@common/trigger_hub"
import {
  FOURTH_LEVEL_COMPRESSOR_DROP_MOVE_FRAMES,
  FOURTH_LEVEL_COMPRESSOR_DROP_STAGE_COUNT,
  FOURTH_LEVEL_COMPRESSOR_HOLD_SECONDS,
  FOURTH_LEVEL_COMPRESSOR_RISE_MOVE_FRAMES,
  FOURTH_LEVEL_COMPRESSOR_RISE_STAGE_COUNT,
  FOURTH_LEVEL_COMPRESSOR_WAIT_SECONDS,
} from "../config"
import { eliminateUnitAndRebirthAtBirth } from "../birth/rebirth"
import { asFixed } from "../layout"
import { GAME_EVENTS } from "./GameEvents"

const TAG = "ZLJ_RUNTIME_COMPRESSOR"

type RuntimeCompressorPiece = {
  name: string
  unit: unknown
  trigger?: unknown
  triggerName?: string
  x: number
  z: number
  sx: number
  sy: number
  sz: number
  upY: number
  downY: number
  moveSeconds: number
}

type PendingCompressorDeathTrigger = {
  trigger: unknown
  triggerName: string
  targetRuntimeName: string
}

declare const EVENT: {
  ANY_LIFEENTITY_TRIGGER_SPACE: string
}
declare const Enums: { TriggerSpaceEventType: { ENTER: number } }

let runtimeCompressorStarted = false
let runtimeCompressorPieces: RuntimeCompressorPiece[] = []
let runtimeCompressorsByName: Record<string, RuntimeCompressorPiece> = {}
let pendingCompressorDeathTriggers: PendingCompressorDeathTrigger[] = []
let compressorCycleGeneration = 0

export function resetRuntimeCompressors(): void {
  runtimeCompressorPieces = []
  runtimeCompressorsByName = {}
  pendingCompressorDeathTriggers = []
  runtimeCompressorStarted = false
}

export function registerRuntimeCompressorPiece(piece: RuntimeCompressorPiece): void {
  runtimeCompressorPieces.push(piece)
  runtimeCompressorsByName[piece.name] = piece
  attachPendingDeathTriggers(piece)
}

export function registerRuntimeCompressorDeathTriggerUnit(trigger: unknown, triggerName: string, targetRuntimeName: string): boolean {
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] death trigger skipped name=${triggerName} target=${targetRuntimeName} trigger=nil`)
    return false
  }
  const piece = runtimeCompressorsByName[targetRuntimeName]
  if (piece === undefined) {
    pendingCompressorDeathTriggers.push({ trigger, triggerName, targetRuntimeName })
    print(`[${TAG}] death trigger pending name=${triggerName} target=${targetRuntimeName}`)
    return true
  }
  bindRuntimeCompressorDeathTrigger(piece, trigger, triggerName)
  return true
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
    print(`[${TAG}] death trigger register skipped name=${piece.name} trigger_name=${piece.triggerName} trigger_id=nil`)
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
}

function bindRuntimeCompressorDeathTrigger(piece: RuntimeCompressorPiece, trigger: unknown, triggerName: string): void {
  piece.trigger = trigger
  piece.triggerName = triggerName
  registerRuntimeCompressorDeathEvent(piece)
}

function attachPendingDeathTriggers(piece: RuntimeCompressorPiece): void {
  if (pendingCompressorDeathTriggers.length === 0) {
    return
  }
  const remaining: PendingCompressorDeathTrigger[] = []
  for (let i = 0; i < pendingCompressorDeathTriggers.length; i++) {
    const pending = pendingCompressorDeathTriggers[i]!
    if (pending.targetRuntimeName === piece.name) {
      bindRuntimeCompressorDeathTrigger(piece, pending.trigger, pending.triggerName)
    } else {
      remaining.push(pending)
    }
  }
  pendingCompressorDeathTriggers = remaining
}

function setRuntimeCompressorPosition(piece: RuntimeCompressorPiece, y: number): void {
  safeCall(
    () => {
      ;(piece.unit as any).set_position(math.Vector3(piece.x as Fixed, y as Fixed, piece.z as Fixed))
    },
    { tag: `runtime_compressor_set_position_${piece.name}`, fallback: undefined, logger: print }
  )
}

function animateRuntimeCompressorByStageFrames(
  piece: RuntimeCompressorPiece,
  direction: "drop" | "rise",
  fromY: number,
  toY: number,
  moveFrames: number,
  stageCount: number,
  done?: () => void
): void {
  const generation = compressorCycleGeneration
  const distance = toY - fromY
  let frame = 0
  setRuntimeCompressorPosition(piece, fromY)

  const step = (): void => {
    if (generation !== compressorCycleGeneration) {
      return
    }
    frame += 1
    const progress = getStageProgress(frame, moveFrames, stageCount)
    const y = fromY + distance * progress
    setRuntimeCompressorPosition(piece, y)
    if (frame < moveFrames) {
      ;(LuaAPI as any).call_delay_frame(1, step)
      return
    }
    setRuntimeCompressorPosition(piece, toY)
    if (done !== undefined) {
      done()
    }
  }

  ;(LuaAPI as any).call_delay_frame(1, step)
}

function getStageProgress(frame: number, totalFrames: number, stageCount: number): number {
  if (totalFrames <= 0 || stageCount <= 0) {
    return 1
  }
  if (frame >= totalFrames) {
    return 1
  }
  const stageIndex = math.min(stageCount, math.max(1, math.ceil((frame * stageCount) / totalFrames)))
  const stageStartFrame = math.floor(((stageIndex - 1) * totalFrames) / stageCount)
  const stageEndFrame = math.floor((stageIndex * totalFrames) / stageCount)
  const stageFrames = math.max(1, stageEndFrame - stageStartFrame)
  const stageProgress = (frame - stageStartFrame) / stageFrames
  return (stageIndex - 1 + stageProgress) / stageCount
}

function animateRuntimeCompressorsByStageFrames(direction: "drop" | "rise", done?: () => void): void {
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
    const moveFrames = direction === "drop" ? FOURTH_LEVEL_COMPRESSOR_DROP_MOVE_FRAMES : FOURTH_LEVEL_COMPRESSOR_RISE_MOVE_FRAMES
    const stageCount = direction === "drop" ? FOURTH_LEVEL_COMPRESSOR_DROP_STAGE_COUNT : FOURTH_LEVEL_COMPRESSOR_RISE_STAGE_COUNT
    animateRuntimeCompressorByStageFrames(
      piece,
      direction,
      fromY,
      toY,
      moveFrames,
      stageCount,
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
    animateRuntimeCompressorsByStageFrames("drop", () => {
      ;(LuaAPI as any).call_delay_time(asFixed(FOURTH_LEVEL_COMPRESSOR_HOLD_SECONDS), () => {
        if (generation !== compressorCycleGeneration) {
          return
        }
        animateRuntimeCompressorsByStageFrames("rise", scheduleRuntimeCompressorCycle)
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
  for (let i = 0; i < runtimeCompressorPieces.length; i++) {
    const piece = runtimeCompressorPieces[i]!
    setRuntimeCompressorPosition(piece, piece.upY)
  }
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
  startRuntimeCompressors()
}

EventBus.on(GAME_EVENTS.PLAYER_DIED_TO_REBIRTH, (_unit: unknown, source: unknown) => {
  resetRuntimeCompressorsToInitial(tostring(source))
})
