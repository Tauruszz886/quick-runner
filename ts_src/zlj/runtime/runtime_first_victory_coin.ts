import { safeCall } from "@common/engine_safe"
import { TriggerHub } from "@common/trigger_hub"
import { RuntimeUiScope, type RuntimeUiClickEvent } from "@gameplay-kits/runtime_ui"
import { UINodes } from "../../generated/exported_data"
import { eliminateUnitAndRebirthAtBirth } from "../birth/rebirth"
import { roleKey } from "./runtime_roles"

const TAG = "ZLJ_FIRST_VICTORY_COIN"
const DEBOUNCE_SECONDS = 1
const PANEL_PARENT = UINodes["画布0"] as ENode
const COIN_INPUT_NAME = "金币"
const COIN_INPUT_BUTTON_NAME = "金币输入按钮"
const INITIAL_COIN_FALLBACK = 1

declare const EVENT: {
  ANY_LIFEENTITY_TRIGGER_SPACE: string
  TIMEOUT: string
}
declare const Enums: { TriggerSpaceEventType: { ENTER: number } }

const rewardDebounce = new Map<string, boolean>()
const coinStateByRole = new Map<string, number>()
let uiScope: RuntimeUiScope | undefined
let coinUiRegistered = false

export function resetFirstVictoryCoinTrigger(): void {
  rewardDebounce.clear()
}

function ensureUiScope(): RuntimeUiScope {
  if (uiScope !== undefined) {
    return uiScope
  }
  uiScope = new RuntimeUiScope({
    parentNode: PANEL_PARENT,
    uiNodes: UINodes,
    uiNodeParents: {},
    logger: print,
  })
  return uiScope
}

function parseCoinText(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined
  }
  const parsed = tonumber(tostring(value))
  if (parsed === null || parsed === undefined) {
    return undefined
  }
  return parsed
}

function readCoinInputText(source: string): string | undefined {
  return safeCall(
    () => {
      const api = GameAPI as any
      if (api.get_input_text === undefined || api.get_input_text === null) {
        return undefined
      }
      return api.get_input_text(UINodes[COIN_INPUT_NAME] as EInputField)
    },
    { tag: `first_victory_coin_read_input_${source}`, fallback: undefined, logger: print }
  ) as string | undefined
}

function readCurrentCoins(role: Role, source: string): number {
  const key = roleKey(role)
  const fromInput = parseCoinText(readCoinInputText(source))
  if (fromInput !== undefined) {
    coinStateByRole.set(key, fromInput)
    return fromInput
  }
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
      role.set_input_field_text(UINodes[COIN_INPUT_NAME] as EInputField, tostring(coins))
    },
    { tag: `first_victory_coin_write_ui_${source}`, fallback: undefined, logger: print }
  )
}

function calculateCoinReward(baseReward: number, _role: Role, _source: string): number {
  return baseReward
}

function syncCoinsFromUi(role: Role, source: string): void {
  const current = readCurrentCoins(role, source)
  writeCoinUi(role, current, source)
  print(`[${TAG}] ui sync source=${source} coins=${current}`)
}

export function registerFirstVictoryCoinUi(): void {
  if (coinUiRegistered) {
    return
  }
  const scope = ensureUiScope()
  const input = scope.getInput(COIN_INPUT_NAME)
  if (input === null) {
    print(`[${TAG}] ui register skipped reason=input_missing name=${COIN_INPUT_NAME}`)
    return
  }
  const button = scope.getOrginButton(COIN_INPUT_BUTTON_NAME)
  if (button === null) {
    print(`[${TAG}] ui register skipped reason=button_missing name=${COIN_INPUT_BUTTON_NAME}`)
    return
  }
  button.setText("")
  button.applyStyle({ enabled: true, touchEnabled: true, opacity: 0 })
  button.setVisible(true)
  const regId = button.onClick((event: RuntimeUiClickEvent) => {
    const eventData = event.data as { role?: Role } | undefined
    const role = eventData !== undefined && eventData.role !== undefined ? eventData.role : (event.actor as Role | undefined)
    if (role === undefined || role === null) {
      print(`[${TAG}] coin input button clicked role=nil`)
      return
    }
    syncCoinsFromUi(role, "coin_input_button")
  }, { tag: "first_victory_coin_input_button" })
  if (regId === null) {
    print(`[${TAG}] ui register skipped reason=button_click_failed name=${COIN_INPUT_BUTTON_NAME}`)
    return
  }
  coinUiRegistered = true
  print(`[${TAG}] ui registered input=${COIN_INPUT_NAME} button=${COIN_INPUT_BUTTON_NAME}`)
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

function giveCoinReward(role: Role, amount: number, source: string): void {
  const currentCoins = readCurrentCoins(role, source)
  const reward = calculateCoinReward(amount, role, source)
  const nextCoins = currentCoins + reward
  writeCoinUi(role, nextCoins, source)
  print(`[${TAG}] coin add source=${source} current=${currentCoins} base=${amount} final=${reward} next=${nextCoins}`)
}

function handleFirstVictoryCoin(unit: unknown, reward: number, respawnAtBirth: boolean, source: string): void {
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
    giveCoinReward(role, reward, source)
    print(`[${TAG}] reward source=${source} coins=${reward}`)
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
  respawnAtBirth: boolean
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
  TriggerHub.register(
    [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
    (_eventName: unknown, _actor: unknown, data: unknown) =>
      handleFirstVictoryCoin(extractTriggerUnit(data), reward, respawnAtBirth, `scene:${name}:${tostring(triggerId)}`),
    {
      safe: true,
      safeCallback: true,
      tag: `first_victory_coin_scene_${name}`,
      logger: print,
    }
  )
  print(`[${TAG}] trigger registered name=${name} trigger_id=${triggerId} coins=${reward} respawn=${tostring(respawnAtBirth)}`)
  return true
}
