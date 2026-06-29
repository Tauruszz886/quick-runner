import { safeCall, safeCreateCustomTriggerSpace } from "@common/engine_safe"
import { EventBus } from "@common/event_bus"
import { TriggerHub } from "@common/trigger_hub"
import { NINTH_LEVEL_TERRAIN_MODULE_INDEX, type RuntimeTerrainPiece } from "../config"
import { eliminateUnitAndRebirthAtBirth } from "../birth/rebirth"
import { asFixed } from "../layout"
import { GAME_EVENTS } from "./GameEvents"
import {
  isThirdLevelVanishingPlatformName,
  normalizeThirdVanishingPlatformName,
  THIRD_CHAIN_DELAY_SECONDS,
  THIRD_DISAPPEAR_SECONDS,
  THIRD_FADE_FRAMES,
  THIRD_FADE_STEP_COLORS,
  THIRD_FADE_STEP_FRAMES,
  THIRD_FADE_STEP_OPACITY,
  THIRD_PLATFORM_BLUE,
  THIRD_TOUCH_OUTLINE_COLOR,
  THIRD_TOUCH_OUTLINE_WIDTH,
  THIRD_VANISHING_TAG,
  THIRD_WAIT_BEFORE_FADE_SECONDS,
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
const PLATFORM_TOP_Y = 6.5
const TRIGGER_HEIGHT = 2.5
const TRIGGER_CENTER_Y = PLATFORM_TOP_Y + TRIGGER_HEIGHT / 2
const NINTH_CHAIN: readonly string[] = ["第09关_dxf_75C_50x20"]
const NINTH_PAINT_AREAS = [1, 2, 3, 4] as const

type NinthPlatform = ThirdVanishingPlatform & {
  trigger?: unknown
  deathTrigger?: unknown
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
let pendingDeathTriggers: PendingTrigger[] = []
let ninthPlatformRegisterLogCount = 0
let ninthTriggerBindLogCount = 0
let ninthDeathTriggerBindLogCount = 0

function normalizeRuntimeName(name: string): string {
  return normalizeThirdVanishingPlatformName(name)
}

export function resetNinthLevelMechanism(): void {
  platforms = []
  platformsByName = {}
  pendingTriggers = []
  pendingDeathTriggers = []
  ninthPlatformRegisterLogCount = 0
  ninthTriggerBindLogCount = 0
  ninthDeathTriggerBindLogCount = 0
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

function trySetModelPhysicVisible(unit: unknown, visible: boolean, name: string): void {
  safeCall(
    () => {
      const target = unit as any
      if (target.set_model_physic_visible !== undefined && target.set_model_physic_visible !== null) {
        target.set_model_physic_visible(visible)
      }
    },
    { tag: `ninth_set_model_physic_visible_${name}`, fallback: undefined, logger: print }
  )
}

function trySetPhysicsActive(unit: unknown, active: boolean, name: string): void {
  safeCall(
    () => {
      const target = unit as any
      if (target.set_physics_active !== undefined && target.set_physics_active !== null) {
        target.set_physics_active(active)
      }
    },
    { tag: `ninth_set_physics_active_${name}`, fallback: undefined, logger: print }
  )
}

function trySetPhysicEnable(unit: unknown, active: boolean, name: string): void {
  safeCall(
    () => {
      const target = unit as any
      if (target.set_physic_enable !== undefined && target.set_physic_enable !== null) {
        target.set_physic_enable(active)
      }
    },
    { tag: `ninth_set_physic_enable_${name}`, fallback: undefined, logger: print }
  )
}

function trySetCollision(unit: unknown, active: boolean, name: string): void {
  safeCall(
    () => {
      const target = unit as any
      if (target.enable_collision !== undefined && target.enable_collision !== null) {
        target.enable_collision(active)
      }
    },
    { tag: `ninth_enable_collision_${name}`, fallback: undefined, logger: print }
  )
}

function restoreNinthPhysics(platform: NinthPlatform): void {
  trySetModelPhysicVisible(platform.unit, true, platform.name)
  trySetPhysicsActive(platform.unit, true, platform.name)
  trySetPhysicEnable(platform.unit, true, platform.name)
  trySetCollision(platform.unit, true, platform.name)
}

function trySetPaintColor(platform: NinthPlatform, color: Color): void {
  for (let i = 0; i < NINTH_PAINT_AREAS.length; i++) {
    const area = NINTH_PAINT_AREAS[i]! as PaintArea
    safeCall(
      () => {
        const target = platform.unit as any
        if (target.set_paint_area_color !== undefined && target.set_paint_area_color !== null) {
          target.set_paint_area_color(area, color)
        }
      },
      { tag: `ninth_set_paint_${platform.name}_${i + 1}`, fallback: undefined, logger: print }
    )
  }
}

function forEachValidRole(callback: (role: unknown) => void, tag: string): void {
  safeCall(
    () => {
      const roles = (GameAPI as any).get_all_valid_roles()
      for (const role of roles as unknown[]) {
        callback(role)
      }
    },
    { tag, fallback: undefined, logger: print }
  )
}

function applyNinthOutline(platform: NinthPlatform): void {
  forEachValidRole(
    (role) => {
      const target = role as any
      if (target.set_unit_outline === undefined || target.set_unit_outline === null) {
        return
      }
      safeCall(
        () => {
          target.set_unit_outline(platform.unit, THIRD_TOUCH_OUTLINE_WIDTH, THIRD_TOUCH_OUTLINE_COLOR)
        },
        { tag: `ninth_touch_outline_${platform.name}`, fallback: undefined, logger: print }
      )
    },
    `ninth_touch_outline_roles_${platform.name}`
  )
}

function clearNinthOutline(platform: NinthPlatform): void {
  forEachValidRole(
    (role) => {
      const target = role as any
      if (target.disable_unit_outline === undefined || target.disable_unit_outline === null) {
        return
      }
      safeCall(
        () => {
          target.disable_unit_outline(platform.unit)
        },
        { tag: `ninth_clear_outline_${platform.name}`, fallback: undefined, logger: print }
      )
    },
    `ninth_clear_outline_roles_${platform.name}`
  )
}

function scheduleDelay(seconds: number, callback: () => void): void {
  safeCall(
    () => {
      ;(LuaAPI as any).call_delay_time(asFixed(seconds), callback)
    },
    { tag: `ninth_delay_${seconds}`, fallback: undefined, logger: print }
  )
}

function scheduleNextFrame(callback: () => void): void {
  safeCall(
    () => {
      ;(LuaAPI as any).call_delay_frame(1, callback)
    },
    { tag: "ninth_delay_frame", fallback: undefined, logger: print }
  )
}

function restoreNinthPlatform(platform: NinthPlatform): void {
  platform.fading = false
  platform.hidden = false
  clearNinthOutline(platform)
  trySetModelVisible(platform.unit, true, platform.name)
  trySetOpacity(platform.unit, 1, platform.name)
  trySetPaintColor(platform, THIRD_PLATFORM_BLUE)
  restoreNinthPhysics(platform)
}

function getNinthFadeStep(frame: number): number {
  if (frame >= THIRD_FADE_FRAMES) {
    return 3
  }
  if (frame >= THIRD_FADE_STEP_FRAMES * 2) {
    return 2
  }
  if (frame >= THIRD_FADE_STEP_FRAMES) {
    return 1
  }
  return 0
}

function fadeNinthPlatform(platform: NinthPlatform, generation: number): void {
  let frame = 0
  const tick = (): void => {
    if (generation !== platform.generation || !platform.fading) {
      return
    }
    frame += 1
    const fadeStep = getNinthFadeStep(frame)
    trySetOpacity(platform.unit, THIRD_FADE_STEP_OPACITY[fadeStep]!, platform.name)
    trySetPaintColor(platform, THIRD_FADE_STEP_COLORS[fadeStep]!)
    if (frame < THIRD_FADE_FRAMES) {
      scheduleNextFrame(tick)
      return
    }
    platform.hidden = true
    platform.fading = false
    clearNinthOutline(platform)
    trySetModelPhysicVisible(platform.unit, false, platform.name)
    scheduleDelay(THIRD_DISAPPEAR_SECONDS, () => {
      if (generation !== platform.generation) {
        return
      }
      restoreNinthPlatform(platform)
    })
  }
  tick()
}

function startNinthPlatformCycle(platform: NinthPlatform, source: string): void {
  if (platform.fading || platform.hidden) {
    print(`[${TAG}] ninth fade skipped name=${platform.name} source=${source} reason=busy`)
    return
  }
  platform.generation += 1
  const generation = platform.generation
  platform.fading = true
  platform.hidden = false
  applyNinthOutline(platform)
  restoreNinthPhysics(platform)
  trySetModelVisible(platform.unit, true, platform.name)
  trySetOpacity(platform.unit, 1, platform.name)
  trySetPaintColor(platform, THIRD_PLATFORM_BLUE)
  scheduleDelay(THIRD_WAIT_BEFORE_FADE_SECONDS, () => {
    if (generation !== platform.generation || !platform.fading) {
      return
    }
    fadeNinthPlatform(platform, generation)
  })
}

function getNinthChainFromName(name: string): string[] | undefined {
  const normalized = normalizeRuntimeName(name)
  for (let i = 0; i < NINTH_CHAIN.length; i++) {
    if (NINTH_CHAIN[i] === normalized) {
      const out: string[] = []
      for (let j = i; j < NINTH_CHAIN.length; j++) {
        out.push(NINTH_CHAIN[j]!)
      }
      return out
    }
  }
  return undefined
}

function startNinthVanishingPlatformChain(platform: NinthPlatform, source: string): void {
  const chain = getNinthChainFromName(platform.name)
  if (chain === undefined) {
    startNinthPlatformCycle(platform, source)
    return
  }
  for (let i = 0; i < chain.length; i++) {
    const targetName = chain[i]!
    const target = platformsByName[normalizeRuntimeName(targetName)]
    if (target === undefined) {
      print(`[${TAG}] ninth chain target missing source=${platform.name} target=${targetName}`)
      continue
    }
    scheduleDelay(i * THIRD_CHAIN_DELAY_SECONDS, () => startNinthPlatformCycle(target, `${source}:chain:${platform.name}:${i}`))
  }
}

function startFade(platform: NinthPlatform, source: string, actor: unknown, data: unknown): void {
  if (platform.fading || platform.hidden) {
    return
  }
  if (platform.thirdLevel) {
    startThirdVanishingPlatformChain(platform, source, platformsByName)
    return
  }
  startNinthVanishingPlatformChain(platform, source)
}

function handleDeathTriggerData(platform: NinthPlatform, source: string, data: unknown): void {
  if (!platform.hidden) {
    return
  }
  const eventData = data as { event_unit?: unknown; unit?: unknown } | undefined
  const unit = eventData?.event_unit !== undefined ? eventData.event_unit : eventData?.unit
  eliminateUnitAndRebirthAtBirth(unit, source)
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
    if (!platform.thirdLevel && ninthTriggerBindLogCount < 2) {
      print(`[${TAG}] ninth trigger bound platform=${platform.name} trigger=${sourceTriggerName} trigger_id=${triggerId}`)
      ninthTriggerBindLogCount += 1
    }
    TriggerHub.register(
      [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
      (_eventName: unknown, actor: unknown, data: unknown) =>
        startFade(platform, `trigger:${sourceTriggerName}:${tostring(triggerId)}`, actor, data),
      { safe: true, safeCallback: true, tag: `vanishing_platform_trigger_${platform.name}`, logger: print }
    )
  }
}

function registerDeathTrigger(platform: NinthPlatform, trigger: unknown, triggerName: string): boolean {
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] ninth death trigger skipped platform=${platform.name} trigger_name=${triggerName} trigger=nil`)
    return false
  }
  platform.deathTrigger = trigger
  const triggerId = safeCall(
    () => {
      return (trigger as any).get_id()
    },
    { tag: `ninth_death_trigger_id_${platform.name}`, fallback: null, logger: print }
  )
  if (triggerId === null || triggerId === undefined) {
    print(`[${TAG}] ninth death trigger skipped platform=${platform.name} trigger_name=${triggerName} trigger_id=nil`)
    return false
  }
  if (ninthDeathTriggerBindLogCount < 2) {
    print(`[${TAG}] ninth death trigger bound platform=${platform.name} trigger=${triggerName} trigger_id=${triggerId}`)
    ninthDeathTriggerBindLogCount += 1
  }
  TriggerHub.register(
    [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
    (_eventName: unknown, _actor: unknown, data: unknown) =>
      handleDeathTriggerData(platform, `ninth_hidden:${triggerName}:${tostring(triggerId)}`, data),
    { safe: true, safeCallback: true, tag: `ninth_vanishing_death_${platform.name}`, logger: print }
  )
  return true
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

function attachPendingDeathTriggers(platform: NinthPlatform): void {
  if (pendingDeathTriggers.length === 0) {
    return
  }
  const platformName = normalizeRuntimeName(platform.name)
  const remaining: PendingTrigger[] = []
  for (let i = 0; i < pendingDeathTriggers.length; i++) {
    const pending = pendingDeathTriggers[i]!
    if (normalizeRuntimeName(pending.targetRuntimeName) === platformName) {
      registerDeathTrigger(platform, pending.trigger, pending.triggerName)
    } else {
      remaining.push(pending)
    }
  }
  pendingDeathTriggers = remaining
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
  attachPendingDeathTriggers(platform)
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
  platform.thirdLevel = false
  restoreNinthPlatform(platform)
  if (ninthPlatformRegisterLogCount < 2) {
    print(`[${TAG}] ninth platform registered name=${platform.name} pending_triggers=${pendingTriggers.length}`)
    ninthPlatformRegisterLogCount += 1
  }
}

export function registerNinthVanishingTriggerBinding(trigger: unknown, triggerName: string, targetRuntimeName: string): boolean {
  const targetName = normalizeRuntimeName(targetRuntimeName)
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] ninth trigger skipped name=${triggerName} target=${targetName} raw_target=${targetRuntimeName} trigger=nil`)
    return false
  }
  let platform = platformsByName[targetName]
  if (platform === undefined) {
    pendingTriggers.push({ trigger, triggerName, targetRuntimeName: targetName })
    print(`[${TAG}] ninth fade setup pending trigger_name=${triggerName} target=${targetName} reason=target_platform_not_registered`)
    return true
  }
  platform.thirdLevel = false
  registerTrigger(platform, trigger, triggerName)
  return true
}

export function registerNinthVanishingDeathTriggerBinding(trigger: unknown, triggerName: string, targetRuntimeName: string): boolean {
  const targetName = normalizeRuntimeName(targetRuntimeName)
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] ninth death trigger skipped name=${triggerName} target=${targetName} raw_target=${targetRuntimeName} trigger=nil`)
    return false
  }
  const platform = platformsByName[targetName]
  if (platform === undefined) {
    pendingDeathTriggers.push({ trigger, triggerName, targetRuntimeName: targetName })
    print(`[${TAG}] ninth death setup pending trigger_name=${triggerName} target=${targetName} reason=target_platform_not_registered`)
    return true
  }
  platform.thirdLevel = false
  return registerDeathTrigger(platform, trigger, triggerName)
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
    if (platform.thirdLevel) {
      clearThirdVanishingPlatformOutline(platform, `reset:${source}`)
      resetThirdVanishingPlatform(platform, source)
    } else {
      restoreNinthPlatform(platform)
    }
  }
}

EventBus.on(GAME_EVENTS.PLAYER_DIED_TO_REBIRTH, (_unit: unknown, source: unknown) => {
  resetNinthLevelPlatformsToInitial(tostring(source))
})
