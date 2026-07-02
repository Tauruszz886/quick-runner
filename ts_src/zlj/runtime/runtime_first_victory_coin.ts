import { safeCall } from "@common/engine_safe"
import { toNumber as coerceNumber } from "@common/num"
import { TriggerHub } from "@common/trigger_hub"
import { UINodes } from "../../generated/exported_data"
import { eliminateUnitAndRebirthAtBirth } from "../birth/rebirth"
import { showCoinWorldFloatingText, type WorldFloatPosition } from "../progression/screen_experience_float"
import { getOnlineRoles, roleKey } from "./runtime_roles"

const TAG = "ZLJ_FIRST_VICTORY_COIN"
const DEBOUNCE_SECONDS = 1
const COIN_LABEL = UINodes["金币"] as unknown as ELabel
const INITIAL_COIN_FALLBACK = 1
const COIN_FLOAT_AFTER_REBIRTH_DELAY_SECONDS = 1.2

declare const EVENT: {
  ANY_LIFEENTITY_TRIGGER_SPACE: string
  TIMEOUT: string
}
declare const Enums: { TriggerSpaceEventType: { ENTER: number } }

const rewardDebounce = new Map<string, boolean>()
const coinStateByRole = new Map<string, number>()
const baseRewardByModule = new Map<number, number>()
let coinUiRegistered = false

export function resetFirstVictoryCoinTrigger(): void {
  rewardDebounce.clear()
  baseRewardByModule.clear()
}

function toNumber(value: unknown, ctx: string): number | undefined {
  return coerceNumber(value, { mode: "loose", ctx, logger: print })
}

function getUnitFloatPosition(unit: unknown, source: string): WorldFloatPosition | null {
  const position = safeCall(
    () => {
      const target = unit as any
      if (target.get_position === undefined || target.get_position === null) {
        return null
      }
      return target.get_position()
    },
    { tag: `first_victory_coin_position_${source}`, fallback: null, logger: print }
  ) as Vector3 | null
  if (position === null || position === undefined) {
    return null
  }
  const x = toNumber(position.x, "coin_float_x")
  const y = toNumber(position.y, "coin_float_y")
  const z = toNumber(position.z, "coin_float_z")
  if (x === undefined || y === undefined || z === undefined) {
    return null
  }
  return { x, y, z }
}

function getRoleFloatPosition(role: Role, source: string): WorldFloatPosition | null {
  const unit = safeCall(
    () => {
      return (role as any).get_ctrl_unit()
    },
    { tag: `first_victory_coin_ctrl_unit_${source}`, fallback: null, logger: print }
  )
  return unit === null || unit === undefined ? null : getUnitFloatPosition(unit, source)
}

function scheduleCoinFloatingText(role: Role, amount: number, unit: unknown, respawnAtBirth: boolean, source: string): void {
  if (!respawnAtBirth) {
    const position = getUnitFloatPosition(unit, source)
    if (position !== null) {
      showCoinWorldFloatingText(role, amount, position)
    }
    return
  }

  TriggerHub.register(
    [EVENT.TIMEOUT, COIN_FLOAT_AFTER_REBIRTH_DELAY_SECONDS],
    () => {
      const position = getRoleFloatPosition(role, source)
      if (position !== null) {
        showCoinWorldFloatingText(role, amount, position)
      }
    },
    {
      safe: true,
      safeCallback: true,
      tag: `first_victory_coin_float_after_rebirth_${source}`,
      logger: print,
    }
  )
}

function readCurrentCoins(role: Role): number {
  const key = roleKey(role)
  const cached = coinStateByRole.get(key)
  if (cached !== undefined) {
    return cached
  }
  coinStateByRole.set(key, INITIAL_COIN_FALLBACK)
  return INITIAL_COIN_FALLBACK
}

function writeCoinUi(role: Role, coins: number, source: string): void {
  coinStateByRole.set(roleKey(role), coins)
  safeCall(
    () => {
      role.set_label_text(COIN_LABEL, `金币：${tostring(coins)}`)
    },
    { tag: `first_victory_coin_write_ui_${source}`, fallback: undefined, logger: print }
  )
}

function calculateCoinReward(baseReward: number, multiplier: number, _role: Role, _source: string): number {
  return baseReward * multiplier
}

export function registerFirstVictoryCoinUi(): void {
  if (coinUiRegistered) {
    const roles = getOnlineRoles()
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i]
      if (role !== undefined) {
        writeCoinUi(role, readCurrentCoins(role), "coin_label_refresh")
      }
    }
    return
  }

  const roles = getOnlineRoles()
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]
    if (role !== undefined) {
      writeCoinUi(role, readCurrentCoins(role), "coin_label_register")
    }
  }
  coinUiRegistered = true
  print(`[${TAG}] ui registered label=金币`)
}

function extractTriggerUnit(data: unknown): unknown {
  const eventData = data as { event_unit?: unknown; unit?: unknown } | undefined
  return eventData?.event_unit !== undefined ? eventData.event_unit : eventData?.unit
}

function getUnitRole(unit: unknown, source: string): Role | null {
  return safeCall(
    () => {
      const candidate = unit as any
      if (candidate.get_role !== undefined && candidate.get_role !== null) {
        return candidate.get_role()
      }
      if (candidate.get_ctrl_role !== undefined && candidate.get_ctrl_role !== null) {
        return candidate.get_ctrl_role()
      }
      return null
    },
    { tag: `first_victory_coin_get_role_${source}`, fallback: null, logger: print }
  ) as Role | null
}

function giveCoinReward(role: Role, baseReward: number, multiplier: number, unit: unknown, respawnAtBirth: boolean, source: string): void {
  const currentCoins = readCurrentCoins(role)
  const reward = calculateCoinReward(baseReward, multiplier, role, source)
  const nextCoins = currentCoins + reward
  writeCoinUi(role, nextCoins, source)
  scheduleCoinFloatingText(role, reward, unit, respawnAtBirth, source)
  print(
    `[${TAG}] coin add source=${source} current=${currentCoins} base=${baseReward} multiplier=${multiplier} final=${reward} next=${nextCoins}`
  )
}

function handleVictoryCoin(unit: unknown, baseReward: number, multiplier: number, respawnAtBirth: boolean, source: string): void {
  if (unit === null || unit === undefined) {
    print(`[${TAG}] skipped source=${source} unit=nil`)
    return
  }
  const key = tostring(unit)
  if (rewardDebounce.get(key) === true) {
    return
  }
  rewardDebounce.set(key, true)

  const role = getUnitRole(unit, source)
  if (role === null || role === undefined) {
    print(`[${TAG}] skipped source=${source} role=nil`)
  } else {
    giveCoinReward(role, baseReward, multiplier, unit, respawnAtBirth, source)
    print(`[${TAG}] reward source=${source} base=${baseReward} multiplier=${multiplier}`)
  }

  if (respawnAtBirth) {
    eliminateUnitAndRebirthAtBirth(unit, `first_victory_coin:${source}`)
  }

  TriggerHub.register([EVENT.TIMEOUT, DEBOUNCE_SECONDS], () => rewardDebounce.delete(key), {
    safe: true,
    safeCallback: true,
    tag: `first_victory_coin_debounce_${key}`,
    logger: print,
  })
}

export function registerFirstVictoryCoinTriggerUnit(
  trigger: unknown,
  name: string,
  reward: number,
  respawnAtBirth: boolean,
  module: number
): boolean {
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] trigger register skipped name=${name} trigger=nil`)
    return false
  }
  const triggerId = safeCall(
    () => {
      return (trigger as any).get_id()
    },
    { tag: `first_victory_coin_trigger_id_${name}`, fallback: null, logger: print }
  )
  if (triggerId === null || triggerId === undefined) {
    print(`[${TAG}] trigger register skipped name=${name} trigger_id=nil`)
    return false
  }
  baseRewardByModule.set(module, reward)
  TriggerHub.register(
    [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
    (_eventName: unknown, _actor: unknown, data: unknown) =>
      handleVictoryCoin(extractTriggerUnit(data), reward, 1, respawnAtBirth, `scene:${name}:${tostring(triggerId)}`),
    {
      safe: true,
      safeCallback: true,
      tag: `first_victory_coin_scene_${name}`,
      logger: print,
    }
  )
  print(
    `[${TAG}] trigger registered name=${name} trigger_id=${triggerId} module=${module} coins=${reward} multiplier=1 respawn=${tostring(respawnAtBirth)}`
  )
  return true
}

export function registerVictoryCoinDoubleTriggerUnit(
  trigger: unknown,
  name: string,
  module: number,
  multiplier: number,
  respawnAtBirth: boolean
): boolean {
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] double trigger register skipped name=${name} trigger=nil`)
    return false
  }
  const triggerId = safeCall(
    () => {
      return (trigger as any).get_id()
    },
    { tag: `victory_coin_double_trigger_id_${name}`, fallback: null, logger: print }
  )
  if (triggerId === null || triggerId === undefined) {
    print(`[${TAG}] double trigger register skipped name=${name} trigger_id=nil`)
    return false
  }
  TriggerHub.register(
    [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
    (_eventName: unknown, _actor: unknown, data: unknown) => {
      const baseReward = baseRewardByModule.get(module) === undefined ? 5 : baseRewardByModule.get(module)!
      handleVictoryCoin(
        extractTriggerUnit(data),
        baseReward,
        multiplier,
        respawnAtBirth,
        `double_scene:${name}:${tostring(triggerId)}`
      )
    },
    {
      safe: true,
      safeCallback: true,
      tag: `victory_coin_double_scene_${name}`,
      logger: print,
    }
  )
  print(
    `[${TAG}] double trigger registered name=${name} trigger_id=${triggerId} module=${module} multiplier=${multiplier} respawn=${tostring(respawnAtBirth)}`
  )
  return true
}
