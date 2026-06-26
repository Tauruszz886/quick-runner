import { safeCall } from "@common/engine_safe"
import { EventBus } from "@common/event_bus"
import { TriggerHub } from "@common/trigger_hub"
import {
  BIRTH_SPAWN_X,
  BIRTH_SPAWN_Y,
  BIRTH_SPAWN_Z,
  TAG,
  TRIGGER_RETURN_TO_BIRTH_ENABLED,
} from "../config"
import { GAME_EVENTS } from "../runtime/GameEvents"

const REBIRTH_ARCHIVE_PRIORITY = 100
const DEATH_DELAY_SECONDS = 0.15
const DEBOUNCE_SECONDS = 1

declare const EVENT: {
  TIMEOUT: string
}

const deathDebounce = new Map<string, boolean>()

function birthPosition(): Vector3 {
  return math.Vector3(BIRTH_SPAWN_X as Fixed, BIRTH_SPAWN_Y as Fixed, BIRTH_SPAWN_Z as Fixed)
}

function birthDirection(): Vector3 {
  return math.Vector3(1 as Fixed, 0 as Fixed, 0 as Fixed)
}

function getUnitRole(unit: unknown, source: string): Role | null {
  return safeCall(
    () => {
      const candidate = unit as any
      if (candidate.get_role !== undefined) {
        return candidate.get_role()
      }
      if (candidate.get_ctrl_role !== undefined) {
        return candidate.get_ctrl_role()
      }
      return null
    },
    { tag: `birth_rebirth_get_role_${source}`, fallback: null, logger: print }
  ) as Role | null
}

export function configureRoleBirthRebirthPoint(role: Role, source: string): void {
  safeCall(
    () => {
      ;(role as any).set_archive_point(birthPosition(), REBIRTH_ARCHIVE_PRIORITY, birthDirection())
    },
    { tag: `birth_rebirth_archive_point_${source}`, fallback: undefined, logger: print }
  )
}

export function configureUnitBirthRebirth(unit: unknown, source: string): void {
  if (unit === null || unit === undefined) {
    return
  }
  safeCall(
    () => {
      ;(unit as any).set_auto_reborn_enabled(true)
    },
    { tag: `birth_rebirth_auto_${source}`, fallback: undefined, logger: print }
  )
  safeCall(
    () => {
      ;(unit as any).set_infinite_reborn_enabled(true)
    },
    { tag: `birth_rebirth_infinite_${source}`, fallback: undefined, logger: print }
  )
  safeCall(
    () => {
      ;(unit as any).set_reborn_in_place(false, true)
    },
    { tag: `birth_rebirth_not_in_place_${source}`, fallback: undefined, logger: print }
  )

  const role = getUnitRole(unit, source)
  if (role !== null && role !== undefined) {
    configureRoleBirthRebirthPoint(role, source)
  }
}

export function eliminateUnitAndRebirthAtBirth(unit: unknown, source: string): void {
  if (!TRIGGER_RETURN_TO_BIRTH_ENABLED) {
    print(`[${TAG}] death disabled source=${source}`)
    return
  }
  if (unit === null || unit === undefined) {
    print(`[${TAG}] death skipped source=${source} unit=nil`)
    return
  }
  const key = tostring(unit)
  if (deathDebounce.get(key) === true) {
    return
  }
  deathDebounce.set(key, true)

  TriggerHub.register(
    [EVENT.TIMEOUT, DEATH_DELAY_SECONDS],
    () => {
      configureUnitBirthRebirth(unit, source)
      safeCall(
        () => {
          ;(unit as any).die()
        },
        { tag: `birth_rebirth_die_${source}`, fallback: undefined, logger: print }
      )
      EventBus.emit(GAME_EVENTS.PLAYER_DIED_TO_REBIRTH, unit, source)
    },
    {
      safe: true,
      safeCallback: true,
      tag: `birth_rebirth_death_delay_${source}`,
      logger: print,
    }
  )
  TriggerHub.register([EVENT.TIMEOUT, DEBOUNCE_SECONDS], () => deathDebounce.delete(key), {
    safe: true,
    safeCallback: true,
    tag: `birth_rebirth_debounce_${key}`,
    logger: print,
  })
}
