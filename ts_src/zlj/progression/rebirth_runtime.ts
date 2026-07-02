import { safeCall } from "@common/engine_safe"
import { RuntimeUiScope, type RuntimeUiClickEvent } from "@common/runtime_ui"
import { RebirthCoinMultiplierConfig表, RebirthExpMultiplierConfig表 } from "../../generated/excel_data"
import { UINodes } from "../../generated/exported_data"
import { asFixed } from "../layout"
import { setQuickRunnerSpeed } from "../runtime/runtime_speed"
import { setRebirthCoinMultiplierProvider } from "../runtime/runtime_first_victory_coin"
import { getOnlineRoles, roleKey } from "../runtime/runtime_roles"
import { getRebirthCount, getRebirthExpMultiplier, setRebirthCount } from "./experience_bonus_state"
import { getOrCreateProgressState, resetProgressToLevel } from "./progression_state"
import { updateProgressionUi } from "./progression_ui"

const TAG = "ZLJ_REBIRTH"
const PANEL_PARENT = UINodes["画布0"] as ENode

const REBIRTH_BUTTON = UINodes["重生按钮"] as EButton
const CONFIRM_BUTTON = UINodes["重生确认按钮"] as EButton
const SAFE_CONFIRM_BUTTON = UINodes["安全重生保存进度按钮"] as EButton
const CLOSE_BUTTON = UINodes["重生-关闭"] as EButton
const REBIRTH_READY_HINT = UINodes["重生提示"] as EImage

const PANEL_NODES = [
  UINodes["重生底布"] as ENode,
  UINodes["重生文本"] as ENode,
  UINodes["重生当前次数"] as ENode,
  UINodes["重生当前次数经验倍数"] as ENode,
  UINodes["重生当前次数金币倍数"] as ENode,
  UINodes["重生下一阶段"] as ENode,
  UINodes["重生下一阶段经验倍数"] as ENode,
  UINodes["重生下一阶段金币倍数"] as ENode,
  UINodes["重生进度条"] as ENode,
  UINodes["重生进度条文本"] as ENode,
  UINodes["箭头-经验"] as ENode,
  UINodes["箭头-金币"] as ENode,
  CONFIRM_BUTTON as ENode,
  SAFE_CONFIRM_BUTTON as ENode,
  CLOSE_BUTTON as ENode,
] as const

const CURRENT_COUNT_LABEL = UINodes["重生当前次数"] as ELabel
const CURRENT_EXP_LABEL = UINodes["重生当前次数经验倍数"] as ELabel
const CURRENT_COIN_LABEL = UINodes["重生当前次数金币倍数"] as ELabel
const NEXT_STAGE_LABEL = UINodes["重生下一阶段"] as ELabel
const NEXT_EXP_LABEL = UINodes["重生下一阶段经验倍数"] as ELabel
const NEXT_COIN_LABEL = UINodes["重生下一阶段金币倍数"] as ELabel
const PROGRESS_BAR = UINodes["重生进度条"] as EProgressbar
const PROGRESS_TEXT = UINodes["重生进度条文本"] as ELabel

type RebirthRow = {
  rebirthCount: number
  expMultiplier: number
  unlockLevel: number
  resetLevel: number
}

const PROGRESS_BAR_MAX = 100

let registered = false
let started = false
let generation = 0
let uiScope: RuntimeUiScope | undefined
let safeRebirthPurchaseHandler: ((role: Role) => boolean) | undefined
const panelVisibleByRole = new Map<string, boolean>()

export function setSafeRebirthPurchaseHandler(handler: (role: Role) => boolean): void {
  safeRebirthPurchaseHandler = handler
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

function extractRole(actor: unknown, data: unknown): Role | undefined {
  const eventData = data as { role?: Role } | undefined
  if (eventData?.role !== undefined && eventData.role !== null) {
    return eventData.role
  }
  if (actor !== undefined && actor !== null) {
    return actor as Role
  }
  return undefined
}

function asInteger(value: number): integer {
  return math.tointeger(math.floor(value) as unknown as Fixed)
}

function setVisible(role: Role, node: ENode, visible: boolean, tag: string): void {
  safeCall(
    () => {
      role.set_node_visible(node, visible)
    },
    { tag, fallback: undefined, logger: print }
  )
}

function setLabel(role: Role, label: ELabel, text: string, tag: string): void {
  safeCall(
    () => {
      role.set_label_text(label, text)
    },
    { tag, fallback: undefined, logger: print }
  )
}

function setProgress(role: Role, current: number, tag: string): void {
  safeCall(
    () => {
      role.set_progressbar_min(PROGRESS_BAR, 0 as integer)
      role.set_progressbar_max(PROGRESS_BAR, PROGRESS_BAR_MAX as integer)
      role.set_progressbar_current(PROGRESS_BAR, asInteger(current))
    },
    { tag, fallback: undefined, logger: print }
  )
}

function setPanelVisible(role: Role, visible: boolean): void {
  for (let i = 0; i < PANEL_NODES.length; i++) {
    const node = PANEL_NODES[i]
    if (node !== undefined) {
      setVisible(role, node, visible, "rebirth_panel_visible")
    }
  }
  panelVisibleByRole.set(roleKey(role), visible)
}

function getRebirthRow(rebirthCount: number): RebirthRow {
  for (let i = 0; i < RebirthExpMultiplierConfig表.length; i++) {
    const row = RebirthExpMultiplierConfig表[i]
    if (row !== undefined && row.rebirthCount === rebirthCount) {
      return {
        rebirthCount: row.rebirthCount,
        expMultiplier: row.expMultiplier,
        unlockLevel: row.unlockLevel,
        resetLevel: row.resetLevel,
      }
    }
  }
  return { rebirthCount, expMultiplier: math.max(1, rebirthCount + 1), unlockLevel: 0, resetLevel: 1 }
}

function getNextRebirthRow(currentCount: number): RebirthRow {
  const nextCount = currentCount + 1
  const exact = getRebirthRow(nextCount)
  if (exact.rebirthCount === nextCount) {
    return exact
  }
  return { rebirthCount: nextCount, expMultiplier: math.max(1, nextCount + 1), unlockLevel: 0, resetLevel: 1 }
}

function getCoinMultiplier(rebirthCount: number): number {
  for (let i = 0; i < RebirthCoinMultiplierConfig表.length; i++) {
    const row = RebirthCoinMultiplierConfig表[i]
    if (row !== undefined && row.rebirthCount === rebirthCount) {
      return row.coinMultiplier
    }
  }
  return math.max(1, rebirthCount + 1)
}

function formatMultiplier(multiplier: number): string {
  return `x${tostring(multiplier)}`
}

function isRebirthReady(role: Role): boolean {
  const progressState = getOrCreateProgressState(role)
  const nextRow = getNextRebirthRow(getRebirthCount(role))
  return progressState.levelProgress.level >= nextRow.unlockLevel
}

function updateRebirthReadyHint(role: Role): void {
  setVisible(role, REBIRTH_READY_HINT, isRebirthReady(role), "rebirth_ready_hint_visible")
}

function updateRebirthPanel(role: Role): void {
  const progressState = getOrCreateProgressState(role)
  const level = progressState.levelProgress.level
  const currentCount = getRebirthCount(role)
  const currentRow = getRebirthRow(currentCount)
  const nextRow = getNextRebirthRow(currentCount)
  const requiredLevel = math.max(1, nextRow.unlockLevel)
  const progressValue = math.min(PROGRESS_BAR_MAX, math.max(0, (level / requiredLevel) * PROGRESS_BAR_MAX))

  setLabel(role, CURRENT_COUNT_LABEL, `重生${tostring(currentCount)}`, "rebirth_current_count")
  setLabel(role, CURRENT_EXP_LABEL, `${formatMultiplier(currentRow.expMultiplier)} EXP`, "rebirth_current_exp")
  setLabel(role, CURRENT_COIN_LABEL, `${formatMultiplier(getCoinMultiplier(currentCount))} Coins`, "rebirth_current_coin")
  setLabel(role, NEXT_STAGE_LABEL, `重生${tostring(nextRow.rebirthCount)}`, "rebirth_next_stage")
  setLabel(role, NEXT_EXP_LABEL, `${formatMultiplier(nextRow.expMultiplier)} EXP`, "rebirth_next_exp")
  setLabel(role, NEXT_COIN_LABEL, `${formatMultiplier(getCoinMultiplier(nextRow.rebirthCount))} Coins`, "rebirth_next_coin")
  setLabel(role, PROGRESS_TEXT, `Level：${tostring(level)}/${tostring(requiredLevel)}+`, "rebirth_progress_text")
  setProgress(role, progressValue, "rebirth_progress_bar")
  updateRebirthReadyHint(role)
}

function openPanel(role: Role): void {
  updateRebirthPanel(role)
  setPanelVisible(role, true)
}

function closePanel(role: Role): void {
  setPanelVisible(role, false)
}

function canRebirth(role: Role): boolean {
  return isRebirthReady(role)
}

function applyRebirth(role: Role, resetLevel: boolean, source: string): void {
  if (!canRebirth(role)) {
    updateRebirthPanel(role)
    print(`[${TAG}] rebirth rejected reason=level_not_enough role=${tostring(role)} source=${source}`)
    return
  }

  const progressState = getOrCreateProgressState(role)
  const nextRow = getNextRebirthRow(getRebirthCount(role))
  setRebirthCount(role, nextRow.rebirthCount)
  if (resetLevel) {
    resetProgressToLevel(progressState, math.max(1, nextRow.resetLevel))
  }
  updateProgressionUi(role, progressState)
  setQuickRunnerSpeed(progressState.speed)
  updateRebirthPanel(role)
  print(
    `[${TAG}] rebirth success role=${tostring(role)} count=${tostring(nextRow.rebirthCount)} exp_multiplier=${tostring(
      getRebirthExpMultiplier(nextRow.rebirthCount)
    )} coin_multiplier=${tostring(getCoinMultiplier(nextRow.rebirthCount))} reset_level=${tostring(resetLevel)} source=${source}`
  )
}

function handleOpen(event: RuntimeUiClickEvent): void {
  const role = extractRole(event.actor, event.data)
  if (role !== undefined) {
    openPanel(role)
  }
}

function handleClose(event: RuntimeUiClickEvent): void {
  const role = extractRole(event.actor, event.data)
  if (role !== undefined) {
    closePanel(role)
  }
}

function handleConfirm(event: RuntimeUiClickEvent): void {
  const role = extractRole(event.actor, event.data)
  if (role !== undefined) {
    applyRebirth(role, true, "normal")
  }
}

function handleSafeConfirm(event: RuntimeUiClickEvent): void {
  const role = extractRole(event.actor, event.data)
  if (role === undefined) {
    return
  }
  if (safeRebirthPurchaseHandler !== undefined && !safeRebirthPurchaseHandler(role)) {
    print(`[${TAG}] safe rebirth purchase rejected role=${tostring(role)}`)
    return
  }
  applyRebirth(role, false, "safe")
}

function registerButton(scope: RuntimeUiScope, name: string, handler: (event: RuntimeUiClickEvent) => void, tag: string): void {
  const button = scope.getOrginButton(name)
  if (button === null) {
    print(`[${TAG}] register skipped reason=button_missing name=${name}`)
    return
  }
  button.applyStyle({ enabled: true, touchEnabled: true })
  const regId = button.onClick(handler, { tag })
  if (regId === null) {
    print(`[${TAG}] register skipped reason=on_click_failed name=${name}`)
  }
}

function refreshVisiblePanels(): void {
  const roles = getOnlineRoles()
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]
    if (role !== undefined) {
      updateRebirthReadyHint(role)
      if (panelVisibleByRole.get(roleKey(role)) === true) {
        updateRebirthPanel(role)
      }
    }
  }
}

function tick(loopGeneration: number): void {
  if (!started || loopGeneration !== generation) {
    return
  }
  refreshVisiblePanels()
  LuaAPI.call_delay_time(asFixed(1), () => tick(loopGeneration))
}

export function startRebirthRuntime(): void {
  setRebirthCoinMultiplierProvider((role) => getCoinMultiplier(getRebirthCount(role)))
  if (!registered) {
    const scope = ensureUiScope()
    registerButton(scope, "重生按钮", handleOpen, "rebirth_open")
    registerButton(scope, "重生确认按钮", handleConfirm, "rebirth_confirm")
    registerButton(scope, "安全重生保存进度按钮", handleSafeConfirm, "rebirth_safe_confirm")
    registerButton(scope, "重生-关闭", handleClose, "rebirth_close")
    registered = true
  }

  const roles = getOnlineRoles()
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]
    if (role !== undefined) {
      closePanel(role)
      updateRebirthReadyHint(role)
    }
  }

  if (started) {
    return
  }
  started = true
  generation += 1
  tick(generation)
}
