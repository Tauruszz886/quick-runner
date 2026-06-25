import { safeCall, safeCreateCustomTriggerSpace } from "@common/engine_safe"
import { EventBus } from "@common/event_bus"
import { TriggerHub } from "@common/trigger_hub"
import {
  THIRD_LEVEL_CYCLE_SECONDS,
  THIRD_LEVEL_HIDDEN_SECONDS,
  THIRD_LEVEL_HIDDEN_Y_OFFSET,
  THIRD_LEVEL_NORMAL_COLOR,
  THIRD_LEVEL_TERRAIN_MODULE_INDEX,
  THIRD_LEVEL_TIMED_PLATFORM_SPECS,
  THIRD_LEVEL_VISIBLE_SECONDS,
  THIRD_LEVEL_WARNING_COLOR,
  THIRD_LEVEL_WARNING_SECONDS,
  type ThirdLevelTimedPlatformSpec,
} from "./runtime_third_mechanism_config"
import type { RuntimeTerrainPiece } from "../config"
import { asFixed } from "../layout"
import { eliminateUnitAndRebirthAtBirth } from "../birth/rebirth"
import { GAME_EVENTS } from "./GameEvents"
import { HOLE_DEATH_TRIGGER_CENTER_Y, HOLE_DEATH_TRIGGER_HEIGHT } from "./runtime_fall_return"

const TAG = "ZLJ_THIRD_MECHANISM"
const PAINT_AREAS = [1, 2, 3, 4] as const
const DEATH_TRIGGER_PREFAB_ID = 3101010

declare const EVENT: {
  ANY_LIFEENTITY_TRIGGER_SPACE: string
}
declare const Enums: { TriggerSpaceEventType: { ENTER: number } }

type ThirdLevelPlatformState = "normal" | "warning" | "hidden"

type ThirdLevelTimedPlatform = {
  spec: ThirdLevelTimedPlatformSpec
  name: string
  unit: unknown
  x: number
  y: number
  z: number
  sx: number
  sz: number
  hiddenY: number
  state: ThirdLevelPlatformState
  deathTrigger?: unknown
  deathTriggerId?: unknown
}

let thirdLevelStarted = false
let thirdLevelGeneration = 0
let thirdLevelPlatforms: ThirdLevelTimedPlatform[] = []
let thirdLevelTriggerScopeId: number | null = null

export function resetThirdLevelMechanism(): void {
  if (thirdLevelTriggerScopeId !== null) {
    TriggerHub.disposeScope(thirdLevelTriggerScopeId, { safe: true, logger: print })
    thirdLevelTriggerScopeId = null
  }
  thirdLevelPlatforms = []
  thirdLevelStarted = false
  thirdLevelGeneration += 1
}

function findSpec(pieceName: string): ThirdLevelTimedPlatformSpec | undefined {
  for (let i = 0; i < THIRD_LEVEL_TIMED_PLATFORM_SPECS.length; i++) {
    const spec = THIRD_LEVEL_TIMED_PLATFORM_SPECS[i]!
    if (spec.pieceName === pieceName) {
      return spec
    }
  }
  return undefined
}

export function isThirdLevelTimedPlatformPiece(moduleIndex: number, piece: RuntimeTerrainPiece): boolean {
  return moduleIndex === THIRD_LEVEL_TERRAIN_MODULE_INDEX && findSpec(piece.name) !== undefined
}

function vec3(x: number, y: number, z: number): unknown {
  return math.Vector3(asFixed(x), asFixed(y), asFixed(z))
}

function ensureThirdLevelTriggerScope(): number {
  if (thirdLevelTriggerScopeId === null) {
    thirdLevelTriggerScopeId = TriggerHub.createScope("third_level_hidden_platform_death")
  }
  return thirdLevelTriggerScopeId
}

function extractTriggerUnit(data: unknown): unknown {
  const eventData = data as { event_unit?: unknown; unit?: unknown } | undefined
  return eventData?.event_unit !== undefined ? eventData.event_unit : eventData?.unit
}

function registerHiddenDeathTrigger(platform: ThirdLevelTimedPlatform): void {
  const trigger = safeCreateCustomTriggerSpace(
    DEATH_TRIGGER_PREFAB_ID,
    vec3(platform.x, HOLE_DEATH_TRIGGER_CENTER_Y, platform.z),
    vec3(platform.sx, HOLE_DEATH_TRIGGER_HEIGHT, platform.sz),
    { tag: `third_hidden_death_trigger_create_${platform.name}`, logger: print }
  )
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] hidden death trigger create failed label=${platform.spec.label} name=${platform.name}`)
    return
  }
  const triggerId = safeCall(
    () => {
      return (trigger as any).get_id()
    },
    { tag: `third_hidden_death_trigger_id_${platform.name}`, fallback: null, logger: print }
  )
  platform.deathTrigger = trigger
  platform.deathTriggerId = triggerId
  if (triggerId !== null && triggerId !== undefined) {
    TriggerHub.register(
      [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
      (_eventName: unknown, _actor: unknown, data: unknown) => {
        if (platform.state !== "hidden") {
          return
        }
        print(
          `[${TAG}] hidden_death label=${platform.spec.label} group=${platform.spec.groupName} name=${platform.name} trigger=${tostring(triggerId)}`
        )
        eliminateUnitAndRebirthAtBirth(
          extractTriggerUnit(data),
          `third_hidden_platform:${platform.name}:${tostring(triggerId)}`
        )
      },
      {
        scopeId: ensureThirdLevelTriggerScope(),
        safe: true,
        safeCallback: true,
        tag: `third_hidden_death_${platform.name}`,
        logger: print,
      }
    )
  }
  print(
    `[${TAG}] hidden death trigger registered label=${platform.spec.label} group=${platform.spec.groupName} name=${platform.name} trigger=${tostring(trigger)} id=${tostring(triggerId)} pos=(${platform.x},${HOLE_DEATH_TRIGGER_CENTER_Y},${platform.z}) scale=(${platform.sx},${HOLE_DEATH_TRIGGER_HEIGHT},${platform.sz})`
  )
}

function setPosition(platform: ThirdLevelTimedPlatform, y: number): void {
  safeCall(
    () => {
      ;(platform.unit as any).set_position(vec3(platform.x, y, platform.z))
    },
    { tag: `third_set_position_${platform.name}`, fallback: undefined, logger: print }
  )
}

function setOpacity(platform: ThirdLevelTimedPlatform, opacity: number): void {
  safeCall(
    () => {
      const target = platform.unit as any
      if (target.set_opacity !== undefined && target.set_opacity !== null) {
        target.set_opacity(asFixed(opacity))
      }
    },
    { tag: `third_set_opacity_${platform.name}`, fallback: undefined, logger: print }
  )
}

function setModelVisible(platform: ThirdLevelTimedPlatform, visible: boolean): void {
  safeCall(
    () => {
      const target = platform.unit as any
      if (target.set_model_visible !== undefined && target.set_model_visible !== null) {
        target.set_model_visible(visible)
      }
    },
    { tag: `third_set_model_visible_${platform.name}`, fallback: undefined, logger: print }
  )
}

function setPaintColor(platform: ThirdLevelTimedPlatform, color: Color): void {
  for (let i = 0; i < PAINT_AREAS.length; i++) {
    const area = PAINT_AREAS[i]! as PaintArea
    safeCall(
      () => {
        const target = platform.unit as any
        if (target.set_paint_area_color !== undefined && target.set_paint_area_color !== null) {
          target.set_paint_area_color(area, color)
        }
      },
      { tag: `third_set_paint_${platform.name}_${i + 1}`, fallback: undefined, logger: print }
    )
  }
}

function restorePlatform(platform: ThirdLevelTimedPlatform): void {
  platform.state = "normal"
  setPosition(platform, platform.y)
  setModelVisible(platform, true)
  setOpacity(platform, 1)
  setPaintColor(platform, THIRD_LEVEL_NORMAL_COLOR)
}

function warnPlatform(platform: ThirdLevelTimedPlatform, generation: number): void {
  if (generation !== thirdLevelGeneration || !thirdLevelStarted) {
    return
  }
  platform.state = "warning"
  setPosition(platform, platform.y)
  setModelVisible(platform, true)
  setOpacity(platform, 0.72)
  setPaintColor(platform, THIRD_LEVEL_WARNING_COLOR)
  scheduleDelay(THIRD_LEVEL_WARNING_SECONDS, () => hidePlatform(platform, generation), `hide_${platform.name}`)
}

function hidePlatform(platform: ThirdLevelTimedPlatform, generation: number): void {
  if (generation !== thirdLevelGeneration || !thirdLevelStarted) {
    return
  }
  platform.state = "hidden"
  setOpacity(platform, 0)
  setModelVisible(platform, false)
  setPosition(platform, platform.hiddenY)
  scheduleDelay(THIRD_LEVEL_HIDDEN_SECONDS, () => recoverPlatform(platform, generation), `recover_${platform.name}`)
}

function recoverPlatform(platform: ThirdLevelTimedPlatform, generation: number): void {
  if (generation !== thirdLevelGeneration || !thirdLevelStarted) {
    return
  }
  restorePlatform(platform)
  const nextWarningDelay = THIRD_LEVEL_CYCLE_SECONDS - THIRD_LEVEL_VISIBLE_SECONDS - THIRD_LEVEL_WARNING_SECONDS - THIRD_LEVEL_HIDDEN_SECONDS
  scheduleDelay(nextWarningDelay, () => warnPlatform(platform, generation), `next_warning_${platform.name}`)
}

function scheduleDelay(seconds: number, callback: () => void, tag: string): void {
  safeCall(
    () => {
      ;(LuaAPI as any).call_delay_time(asFixed(seconds), callback)
    },
    { tag: `third_delay_${tag}`, fallback: undefined, logger: print }
  )
}

function scheduleInitialPlatform(platform: ThirdLevelTimedPlatform, generation: number): void {
  const warningDelay = platform.spec.startOffsetSeconds + THIRD_LEVEL_VISIBLE_SECONDS
  scheduleDelay(warningDelay, () => warnPlatform(platform, generation), `initial_warning_${platform.name}`)
}

function resetThirdLevelPlatformsToInitial(source: string): void {
  if (thirdLevelPlatforms.length === 0) {
    return
  }
  thirdLevelGeneration += 1
  thirdLevelStarted = false
  for (let i = 0; i < thirdLevelPlatforms.length; i++) {
    restorePlatform(thirdLevelPlatforms[i]!)
  }
  print(`[${TAG}] reset_to_initial source=${source} platforms=${thirdLevelPlatforms.length} generation=${thirdLevelGeneration}`)
  startThirdLevelMechanism()
}

export function registerThirdLevelTimedPlatform(
  moduleIndex: number,
  piece: RuntimeTerrainPiece,
  unit: unknown,
  name: string,
  x: number,
  y: number,
  z: number
): void {
  if (!isThirdLevelTimedPlatformPiece(moduleIndex, piece) || unit === null || unit === undefined) {
    return
  }
  const spec = findSpec(piece.name)
  if (spec === undefined) {
    return
  }
  const platform: ThirdLevelTimedPlatform = {
    spec,
    name,
    unit,
    x,
    y,
    z,
    sx: piece.sx,
    sz: piece.sz,
    hiddenY: y - piece.sy - THIRD_LEVEL_HIDDEN_Y_OFFSET,
    state: "normal",
  }
  thirdLevelPlatforms.push(platform)
  registerHiddenDeathTrigger(platform)
  restorePlatform(platform)
  print(
    `[${TAG}] registered label=${spec.label} group=${spec.groupName} name=${name} pos=(${x},${y},${z}) hidden_y=${platform.hiddenY} offset=${spec.startOffsetSeconds}`
  )
}

export function startThirdLevelMechanism(): void {
  if (thirdLevelStarted) {
    return
  }
  thirdLevelStarted = true
  if (thirdLevelPlatforms.length === 0) {
    print(`[${TAG}] skipped platforms=0`)
    return
  }
  thirdLevelGeneration += 1
  const generation = thirdLevelGeneration
  for (let i = 0; i < thirdLevelPlatforms.length; i++) {
    const platform = thirdLevelPlatforms[i]!
    restorePlatform(platform)
    scheduleInitialPlatform(platform, generation)
  }
  print(
    `[${TAG}] start platforms=${thirdLevelPlatforms.length} cycle=${THIRD_LEVEL_CYCLE_SECONDS}s visible=${THIRD_LEVEL_VISIBLE_SECONDS}s warning=${THIRD_LEVEL_WARNING_SECONDS}s hidden=${THIRD_LEVEL_HIDDEN_SECONDS}s order=G1:5-9-13 G2:4-8-12 G3:3-7-11 G4:2-6-10`
  )
}

EventBus.on(GAME_EVENTS.PLAYER_DIED_TO_REBIRTH, (_unit: unknown, source: unknown) => {
  resetThirdLevelPlatformsToInitial(tostring(source))
})
