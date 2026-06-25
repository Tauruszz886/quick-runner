import { safeCall, safeCreateCustomTriggerSpace } from "@common/engine_safe"
import { EventBus } from "@common/event_bus"
import { TriggerHub } from "@common/trigger_hub"
import { NINTH_LEVEL_TERRAIN_MODULE_INDEX, type RuntimeTerrainPiece } from "../config"
import { asFixed } from "../layout"
import { GAME_EVENTS } from "./GameEvents"

const TAG = "ZLJ_NINTH_MECHANISM"
const TRIGGER_PREFAB_ID = 3101010
const FADE_SECONDS = 1.5
const FADE_STEPS = 15
const PLATFORM_TOP_Y = 6.5
const TRIGGER_HEIGHT = 2.5
const TRIGGER_CENTER_Y = PLATFORM_TOP_Y + TRIGGER_HEIGHT / 2
const TOUCH_OUTLINE_WIDTH = 3
const TOUCH_OUTLINE_COLOR = 0xff0000 as Color

type NinthPlatform = {
  name: string
  unit: unknown
  trigger?: unknown
  fading: boolean
  hidden: boolean
  generation: number
}

declare const EVENT: {
  ANY_LIFEENTITY_TRIGGER_SPACE: string
}
declare const Enums: { TriggerSpaceEventType: { ENTER: number } }

let platforms: NinthPlatform[] = []

export function resetNinthLevelMechanism(): void {
  platforms = []
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

function hasOutlineApi(role: unknown): boolean {
  const candidate = role as { set_unit_outline?: unknown } | undefined
  return candidate !== undefined && candidate !== null && candidate.set_unit_outline !== undefined && candidate.set_unit_outline !== null
}

function tryApplyOutlineForRole(role: unknown, platform: NinthPlatform): boolean {
  const ok = safeCall(
    () => {
      const target = role as { set_unit_outline?: (unit: unknown, width: integer, color: Color) => void }
      if (!hasOutlineApi(target)) {
        return false
      }
      target.set_unit_outline!(platform.unit, TOUCH_OUTLINE_WIDTH, TOUCH_OUTLINE_COLOR)
      return true
    },
    { tag: `ninth_touch_outline_${platform.name}`, fallback: false, logger: print }
  )
  return ok === true
}

function extractRoleFromTrigger(actor: unknown, data: unknown): unknown {
  if (hasOutlineApi(actor)) {
    return actor
  }
  const eventData = data as { role?: unknown; event_unit?: unknown } | undefined
  if (hasOutlineApi(eventData?.role)) {
    return eventData?.role
  }
  const eventUnit = eventData?.event_unit
  const role = safeCall(
    () => {
      const unit = eventUnit as { get_owner?: () => unknown; get_ctrl_role?: () => unknown } | undefined
      if (unit === undefined || unit === null) {
        return undefined
      }
      if (unit.get_owner !== undefined && unit.get_owner !== null) {
        return unit.get_owner()
      }
      if (unit.get_ctrl_role !== undefined && unit.get_ctrl_role !== null) {
        return unit.get_ctrl_role()
      }
      return undefined
    },
    { tag: `ninth_extract_touch_role`, fallback: undefined, logger: print }
  )
  return hasOutlineApi(role) ? role : undefined
}

function applyTouchOutline(actor: unknown, data: unknown, platform: NinthPlatform): void {
  const role = extractRoleFromTrigger(actor, data)
  let ok = tryApplyOutlineForRole(role, platform)
  if (!ok) {
    ok =
      safeCall(
        () => {
          const roles = (GameAPI as any).get_all_valid_roles()
          let applied = false
          for (const onlineRole of roles as unknown[]) {
            applied = tryApplyOutlineForRole(onlineRole, platform) || applied
          }
          return applied
        },
        { tag: `ninth_touch_outline_all_roles_${platform.name}`, fallback: false, logger: print }
      ) === true
  }
  print(`[${TAG}] touch outline name=${platform.name} ok=${ok} width=${TOUCH_OUTLINE_WIDTH} color=${TOUCH_OUTLINE_COLOR}`)
}

function fadeAndHide(platform: NinthPlatform): void {
  let step = 0
  const generation = platform.generation
  const stepSeconds = FADE_SECONDS / FADE_STEPS
  const tick = (): void => {
    if (generation !== platform.generation || !platform.fading) {
      return
    }
    step += 1
    const opacity = math.max(0, 1 - step / FADE_STEPS)
    trySetOpacity(platform.unit, opacity, platform.name)
    if (step < FADE_STEPS) {
      ;(LuaAPI as any).call_delay_time(asFixed(stepSeconds), tick)
      return
    }
    platform.hidden = true
    platform.fading = false
    trySetModelVisible(platform.unit, false, platform.name)
    print(`[${TAG}] platform hidden name=${platform.name} seconds=${FADE_SECONDS}`)
  }
  tick()
}

function startFade(platform: NinthPlatform, source: string, actor: unknown, data: unknown): void {
  if (platform.fading || platform.hidden) {
    return
  }
  platform.fading = true
  applyTouchOutline(actor, data, platform)
  print(`[${TAG}] fade start name=${platform.name} source=${source} seconds=${FADE_SECONDS}`)
  fadeAndHide(platform)
}

function registerTrigger(platform: NinthPlatform, trigger: unknown): void {
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] trigger register skipped name=${platform.name} trigger=nil`)
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
      (_eventName: unknown, actor: unknown, data: unknown) => startFade(platform, `trigger:${tostring(triggerId)}`, actor, data),
      { safe: true, safeCallback: true, tag: `ninth_platform_trigger_${platform.name}`, logger: print }
    )
  }
  print(`[${TAG}] trigger registered name=${platform.name} trigger=${tostring(trigger)} id=${tostring(triggerId)}`)
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
  const platform: NinthPlatform = { name, unit, fading: false, hidden: false, generation: 0 }
  platforms.push(platform)
  const trigger = safeCreateCustomTriggerSpace(
    TRIGGER_PREFAB_ID,
    vec3(x, TRIGGER_CENTER_Y, z),
    vec3(piece.sx, TRIGGER_HEIGHT, piece.sz),
    { tag: `ninth_trigger_create_${name}`, logger: print }
  )
  registerTrigger(platform, trigger)
  print(
    `[${TAG}] platform registered name=${name} unit=${tostring(unit)} trigger=${tostring(trigger)} trigger_pos=(${x},${TRIGGER_CENTER_Y},${z}) trigger_scale=(${piece.sx},${TRIGGER_HEIGHT},${piece.sz}) fade_seconds=${FADE_SECONDS}`
  )
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
  const platform: NinthPlatform = { name, unit, fading: false, hidden: false, generation: 0 }
  platforms.push(platform)
  const trigger = safeCreateCustomTriggerSpace(
    TRIGGER_PREFAB_ID,
    vec3(x, TRIGGER_CENTER_Y, z),
    vec3(sx, TRIGGER_HEIGHT, sz),
    { tag: `ninth_trigger_create_${name}`, logger: print }
  )
  registerTrigger(platform, trigger)
  print(
    `[${TAG}] platform registered name=${name} source=runtime_scene_binding unit=${tostring(unit)} trigger=${tostring(trigger)} trigger_pos=(${x},${TRIGGER_CENTER_Y},${z}) trigger_scale=(${sx},${TRIGGER_HEIGHT},${sz}) fade_seconds=${FADE_SECONDS}`
  )
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
  }
  print(`[${TAG}] reset_to_initial source=${source} platforms=${platforms.length}`)
}

EventBus.on(GAME_EVENTS.PLAYER_DIED_TO_REBIRTH, (_unit: unknown, source: unknown) => {
  resetNinthLevelPlatformsToInitial(tostring(source))
})
