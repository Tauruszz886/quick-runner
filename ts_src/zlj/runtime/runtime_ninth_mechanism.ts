import { safeCall, safeCreateCustomTriggerSpace } from "@common/engine_safe"
import { EventBus } from "@common/event_bus"
import { TriggerHub } from "@common/trigger_hub"
import { NINTH_LEVEL_TERRAIN_MODULE_INDEX, type RuntimeTerrainPiece } from "../config"
import { asFixed } from "../layout"
import { GAME_EVENTS } from "./GameEvents"
import {
  isThirdLevelVanishingPlatformName,
  normalizeThirdVanishingPlatformName,
  THIRD_VANISHING_TAG,
} from "./third_level/vanishing_platform_config"
import {
  clearThirdVanishingPlatformOutline,
  initializeThirdVanishingPlatform,
  resetThirdVanishingPlatform,
  startThirdVanishingPlatformChain,
  type ThirdVanishingPlatform,
} from "./third_level/vanishing_platforms"

const TAG = THIRD_VANISHING_TAG
const TRIGGER_PREFAB_ID = 3101010
const NINTH_FADE_SECONDS = 1.5
const NINTH_FADE_STEPS = 15
const PLATFORM_TOP_Y = 6.5
const TRIGGER_HEIGHT = 2.5
const TRIGGER_CENTER_Y = PLATFORM_TOP_Y + TRIGGER_HEIGHT / 2

type NinthPlatform = ThirdVanishingPlatform & {
  trigger?: unknown
  thirdLevel: boolean
}

type PendingTrigger = {
  trigger: unknown
  triggerName: string
  targetRuntimeName: string
}

declare const EVENT: {
  ANY_LIFEENTITY_TRIGGER_SPACE: string
}
declare const Enums: { TriggerSpaceEventType: { ENTER: number } }

let platforms: NinthPlatform[] = []
let platformsByName: Record<string, NinthPlatform> = {}
let pendingTriggers: PendingTrigger[] = []

function normalizeRuntimeName(name: string): string {
  return normalizeThirdVanishingPlatformName(name)
}

export function resetNinthLevelMechanism(): void {
  platforms = []
  platformsByName = {}
  pendingTriggers = []
}

function vec3(x: number, y: number, z: number): unknown {
  return math.Vector3(asFixed(x), asFixed(y), asFixed(z))
}

function isNinthVanishingPlatform(piece: RuntimeTerrainPiece): boolean {
  return piece.name === "dxf_760_50x20" || piece.name === "dxf_75C_50x20"
}

export function isNinthVanishingPlatformPiece(moduleIndex: number, piece: RuntimeTerrainPiece): boolean {
  return moduleIndex === NINTH_LEVEL_TERRAIN_MODULE_INDEX && isNinthVanishingPlatform(piece)
}

function trySetOpacity(unit: unknown, opacity: number, name: string): void {
  const ok = safeCall(
    () => {
      const target = unit as any
      if (target.set_opacity !== undefined && target.set_opacity !== null) {
        target.set_opacity(asFixed(opacity))
        return true
      }
      return false
    },
    { tag: `ninth_set_opacity_${name}`, fallback: false, logger: print }
  )
  if (ok !== true && opacity <= 0) {
    safeCall(
      () => {
        const target = unit as any
        if (target.set_model_visible !== undefined && target.set_model_visible !== null) {
          target.set_model_visible(false)
        }
      },
      { tag: `ninth_set_model_visible_${name}`, fallback: undefined, logger: print }
    )
  }
}

function trySetModelVisible(unit: unknown, visible: boolean, name: string): void {
  safeCall(
    () => {
      const target = unit as any
      if (target.set_model_visible !== undefined && target.set_model_visible !== null) {
        target.set_model_visible(visible)
      }
    },
    { tag: `ninth_set_model_visible_${name}`, fallback: undefined, logger: print }
  )
}

function fadeAndHide(platform: NinthPlatform): void {
  let step = 0
  const generation = platform.generation
  const stepSeconds = NINTH_FADE_SECONDS / NINTH_FADE_STEPS
  const tick = (): void => {
    if (generation !== platform.generation || !platform.fading) {
      return
    }
    step += 1
    const opacity = math.max(0, 1 - step / NINTH_FADE_STEPS)
    trySetOpacity(platform.unit, opacity, platform.name)
    if (step < NINTH_FADE_STEPS) {
      ;(LuaAPI as any).call_delay_time(asFixed(stepSeconds), tick)
      return
    }
    platform.hidden = true
    platform.fading = false
    trySetModelVisible(platform.unit, false, platform.name)
  }
  tick()
}

function startFade(platform: NinthPlatform, source: string, actor: unknown, data: unknown): void {
  if (platform.fading || platform.hidden) {
    return
  }
  if (platform.thirdLevel) {
    startThirdVanishingPlatformChain(platform, source, platformsByName)
    return
  }
  platform.fading = true
  fadeAndHide(platform)
}

function registerTrigger(platform: NinthPlatform, trigger: unknown, triggerName?: string): void {
  const displayTriggerName = triggerName === undefined ? "" : triggerName
  const sourceTriggerName = triggerName === undefined ? platform.name : triggerName
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] trigger register skipped name=${platform.name} trigger_name=${displayTriggerName} trigger=nil`)
    return
  }
  platform.trigger = trigger
  const triggerId = safeCall(
    () => {
      return (trigger as any).get_id()
    },
    { tag: `ninth_trigger_id_${platform.name}`, fallback: null, logger: print }
  )
  if (triggerId !== null && triggerId !== undefined) {
    TriggerHub.register(
      [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
      (_eventName: unknown, actor: unknown, data: unknown) =>
        startFade(platform, `trigger:${sourceTriggerName}:${tostring(triggerId)}`, actor, data),
      { safe: true, safeCallback: true, tag: `vanishing_platform_trigger_${platform.name}`, logger: print }
    )
  }
}

function queryUnitByRuntimeName(runtimeName: string): unknown {
  const direct = safeCall(
    () => {
      return (LuaAPI as any).query_unit(runtimeName)
    },
    { tag: `vanishing_query_unit_${runtimeName}`, fallback: null, logger: print }
  )
  if (direct !== null && direct !== undefined) {
    return direct
  }
  if (runtimeName.substring(0, 3) === "QR_") {
    return null
  }
  return safeCall(
    () => {
      return (LuaAPI as any).query_unit(`QR_${runtimeName}`)
    },
    { tag: `vanishing_query_unit_QR_${runtimeName}`, fallback: null, logger: print }
  )
}

function attachPendingTriggers(platform: NinthPlatform): void {
  if (pendingTriggers.length === 0) {
    return
  }
  const platformName = normalizeRuntimeName(platform.name)
  const remaining: PendingTrigger[] = []
  for (let i = 0; i < pendingTriggers.length; i++) {
    const pending = pendingTriggers[i]!
    if (normalizeRuntimeName(pending.targetRuntimeName) === platformName) {
      registerTrigger(platform, pending.trigger, pending.triggerName)
    } else {
      remaining.push(pending)
    }
  }
  pendingTriggers = remaining
}

export function registerVanishingPlatformBinding(unit: unknown, name: string): boolean {
  if (unit === null || unit === undefined) {
    return false
  }
  const platformName = normalizeRuntimeName(name)
  let platform = platformsByName[platformName]
  if (platform === undefined) {
    platform = { name: platformName, unit, fading: false, hidden: false, generation: 0, thirdLevel: isThirdLevelVanishingPlatformName(platformName) }
    platforms.push(platform)
    platformsByName[platformName] = platform
  } else {
    platform.unit = unit
    platform.thirdLevel = platform.thirdLevel || isThirdLevelVanishingPlatformName(platformName)
  }
  trySetModelVisible(platform.unit, true, platform.name)
  trySetOpacity(platform.unit, 1, platform.name)
  if (platform.thirdLevel) {
    initializeThirdVanishingPlatform(platform)
  }
  attachPendingTriggers(platform)
  return true
}

export function registerVanishingPlatformTriggerBinding(trigger: unknown, triggerName: string, targetRuntimeName: string): boolean {
  const targetName = normalizeRuntimeName(targetRuntimeName)
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] trigger skipped name=${triggerName} target=${targetName} raw_target=${targetRuntimeName} trigger=nil`)
    return false
  }
  let platform = platformsByName[targetName]
  if (platform === undefined) {
    const targetUnit = queryUnitByRuntimeName(targetRuntimeName)
    if (targetUnit !== null && targetUnit !== undefined) {
      registerVanishingPlatformBinding(targetUnit, targetRuntimeName)
      platform = platformsByName[targetName]
    }
  }
  if (platform === undefined) {
    pendingTriggers.push({ trigger, triggerName, targetRuntimeName: targetName })
    print(`[${TAG}] third fade setup pending trigger_name=${triggerName} target=${targetName} reason=target_platform_not_registered`)
    return true
  }
  registerTrigger(platform, trigger, triggerName)
  return true
}

export function registerNinthVanishingPlatform(
  moduleIndex: number,
  piece: RuntimeTerrainPiece,
  unit: unknown,
  name: string,
  x: number,
  z: number
): void {
  if (!isNinthVanishingPlatformPiece(moduleIndex, piece) || unit === null || unit === undefined) {
    return
  }
  registerVanishingPlatformBinding(unit, name)
  const platform = platformsByName[normalizeRuntimeName(name)]!
  const trigger = safeCreateCustomTriggerSpace(
    TRIGGER_PREFAB_ID,
    vec3(x, TRIGGER_CENTER_Y, z),
    vec3(piece.sx, TRIGGER_HEIGHT, piece.sz),
    { tag: `ninth_trigger_create_${name}`, logger: print }
  )
  registerTrigger(platform, trigger)
}

export function registerNinthVanishingPlatformBinding(
  unit: unknown,
  name: string,
  x: number,
  z: number,
  sx: number,
  sz: number
): void {
  if (unit === null || unit === undefined) {
    return
  }
  registerVanishingPlatformBinding(unit, name)
  const platform = platformsByName[normalizeRuntimeName(name)]!
  const trigger = safeCreateCustomTriggerSpace(
    TRIGGER_PREFAB_ID,
    vec3(x, TRIGGER_CENTER_Y, z),
    vec3(sx, TRIGGER_HEIGHT, sz),
    { tag: `ninth_trigger_create_${name}`, logger: print }
  )
  registerTrigger(platform, trigger)
}

function resetNinthLevelPlatformsToInitial(source: string): void {
  if (platforms.length === 0) {
    return
  }
  for (let i = 0; i < platforms.length; i++) {
    const platform = platforms[i]!
    platform.generation += 1
    platform.fading = false
    platform.hidden = false
    trySetModelVisible(platform.unit, true, platform.name)
    trySetOpacity(platform.unit, 1, platform.name)
    clearThirdVanishingPlatformOutline(platform, `reset:${source}`)
    if (platform.thirdLevel) {
      resetThirdVanishingPlatform(platform, source)
    }
  }
}

EventBus.on(GAME_EVENTS.PLAYER_DIED_TO_REBIRTH, (_unit: unknown, source: unknown) => {
  resetNinthLevelPlatformsToInitial(tostring(source))
})
