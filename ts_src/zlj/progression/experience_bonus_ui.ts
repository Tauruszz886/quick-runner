import { safeCall } from "@common/engine_safe"
import { RuntimeUiScope, type RuntimeUiClickEvent } from "@common/runtime_ui"
import { UINodes } from "../../generated/exported_data"
import { asFixed } from "../layout"
import { getOnlineRoles } from "../runtime/runtime_roles"
import {
  getDailyBonusPercent,
  getDailyConsecutiveDays,
  getDoubleExpBuffRemainingSeconds,
  getOnlineBonusPercent,
  getOrCreateExperienceBonusState,
  requestDoubleExpBuff,
  tickDoubleExpBuff,
  tickExperienceBonusOnlineTime,
} from "./experience_bonus_state"

const TAG = "ZLJ_EXP_BONUS_UI"
const PANEL_PARENT = UINodes["画布0"] as ENode
const DOUBLE_EXP_BUTTON = UINodes["双倍经验BUFF"] as EButton
const DOUBLE_EXP_COUNTDOWN = UINodes["双倍经验倒计时"] as ELabel
const ONLINE_BUTTON = UINodes["在线提升"] as EButton
const ONLINE_NOTE = UINodes["在线提升注释"] as ELabel
const DAILY_BUTTON = UINodes["每日加成%"] as EButton
const DAILY_NOTE = UINodes["每日加成注释"] as ELabel

const TICK_SECONDS = 1
const DEFAULT_DOUBLE_EXP_TIME_TEXT = "05:00"
const NOTE_CLICK_LOCK_SECONDS = 0.12

let registered = false
let started = false
let generation = 0
let noteClickLocked = false
let uiScope: RuntimeUiScope | undefined
const visibleNoteByRole = new Map<string, "online" | "daily" | undefined>()

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

function roleKey(role: Role): string {
  return tostring(role)
}

function asDisplayInteger(value: number): string {
  const integerValue = math.tointeger(math.floor(value) as unknown as Fixed)
  return tostring(integerValue)
}

function formatTime(seconds: number): string {
  const clamped = math.max(0, math.floor(seconds))
  const minutes = math.floor(clamped / 60)
  const secs = clamped % 60
  return `${minutes < 10 ? "0" : ""}${asDisplayInteger(minutes)}:${secs < 10 ? "0" : ""}${asDisplayInteger(secs)}`
}

function getDoubleExpCountdownText(remainingSeconds: number): string {
  if (remainingSeconds <= 0) {
    return DEFAULT_DOUBLE_EXP_TIME_TEXT
  }
  return formatTime(remainingSeconds)
}

function setCanvasTouchEnabled(role: Role, enabled: boolean): void {
  safeCall(
    () => {
      role.set_node_touch_enabled(PANEL_PARENT, enabled)
    },
    { tag: "exp_bonus_canvas_touch_enabled", fallback: undefined, logger: print }
  )
}

function setNodeVisible(role: Role, node: ENode, visible: boolean, tag: string): void {
  safeCall(
    () => {
      role.set_node_visible(node, visible)
    },
    { tag, fallback: undefined, logger: print }
  )
}

function setLabelText(role: Role, label: ELabel, text: string, tag: string): void {
  safeCall(
    () => {
      role.set_label_text(label, text)
    },
    { tag, fallback: undefined, logger: print }
  )
}

function setButtonText(role: Role, button: EButton, text: string, tag: string): void {
  safeCall(
    () => {
      role.set_button_text(button, text)
    },
    { tag, fallback: undefined, logger: print }
  )
}

function hideNotes(role: Role): void {
  setNodeVisible(role, ONLINE_NOTE, false, "exp_bonus_online_note_hide")
  setNodeVisible(role, DAILY_NOTE, false, "exp_bonus_daily_note_hide")
  setCanvasTouchEnabled(role, false)
  visibleNoteByRole.set(roleKey(role), undefined)
}

function showOnlineNote(role: Role): void {
  setLabelText(
    role,
    ONLINE_NOTE,
    "游玩提升每玩一分钟获得1%经验值加成",
    "exp_bonus_online_note_text"
  )
  setNodeVisible(role, DAILY_NOTE, false, "exp_bonus_daily_note_hide_for_online")
  setNodeVisible(role, ONLINE_NOTE, true, "exp_bonus_online_note_show")
  setCanvasTouchEnabled(role, true)
  visibleNoteByRole.set(roleKey(role), "online")
}

function showDailyNote(role: Role): void {
  setLabelText(
    role,
    DAILY_NOTE,
    "每日加成连续每天游戏可获得10%经验值加成",
    "exp_bonus_daily_note_text"
  )
  setNodeVisible(role, ONLINE_NOTE, false, "exp_bonus_online_note_hide_for_daily")
  setNodeVisible(role, DAILY_NOTE, true, "exp_bonus_daily_note_show")
  setCanvasTouchEnabled(role, true)
  visibleNoteByRole.set(roleKey(role), "daily")
}

function toggleOnlineNote(role: Role): void {
  if (visibleNoteByRole.get(roleKey(role)) === "online") {
    hideNotes(role)
    return
  }
  showOnlineNote(role)
}

function toggleDailyNote(role: Role): void {
  if (visibleNoteByRole.get(roleKey(role)) === "daily") {
    hideNotes(role)
    return
  }
  showDailyNote(role)
}

function lockNoteCanvasDismiss(): void {
  noteClickLocked = true
  LuaAPI.call_delay_time(asFixed(NOTE_CLICK_LOCK_SECONDS), () => {
    noteClickLocked = false
  })
}

function updateRoleUi(role: Role): void {
  getOrCreateExperienceBonusState(role)
  setButtonText(role, ONLINE_BUTTON, `${tostring(getOnlineBonusPercent(role))}%`, "exp_bonus_online_button_text")
  setButtonText(role, DAILY_BUTTON, `${tostring(getDailyBonusPercent(role))}%`, "exp_bonus_daily_button_text")
  const remaining = getDoubleExpBuffRemainingSeconds(role)
  setLabelText(role, DOUBLE_EXP_COUNTDOWN, getDoubleExpCountdownText(remaining), "exp_bonus_double_countdown_text")
  setNodeVisible(role, DOUBLE_EXP_COUNTDOWN, remaining > 0, "exp_bonus_double_countdown_visible")
  if (visibleNoteByRole.get(roleKey(role)) === "online") {
    showOnlineNote(role)
  } else if (visibleNoteByRole.get(roleKey(role)) === "daily") {
    showDailyNote(role)
  } else {
    hideNotes(role)
  }
}

function handleDoubleExpButtonClick(event: RuntimeUiClickEvent): void {
  const role = extractRole(event.actor, event.data)
  if (role === undefined) {
    return
  }
  if (!requestDoubleExpBuff(role)) {
    print(`[${TAG}] double exp purchase rejected role=${tostring(role)}`)
    return
  }
  updateRoleUi(role)
  print(`[${TAG}] double exp buff activated role=${tostring(role)} seconds=${tostring(getDoubleExpBuffRemainingSeconds(role))}`)
}

function handleOnlineButtonClick(event: RuntimeUiClickEvent): void {
  const role = extractRole(event.actor, event.data)
  if (role !== undefined) {
    lockNoteCanvasDismiss()
    toggleOnlineNote(role)
  }
}

function handleDailyButtonClick(event: RuntimeUiClickEvent): void {
  const role = extractRole(event.actor, event.data)
  if (role !== undefined) {
    lockNoteCanvasDismiss()
    toggleDailyNote(role)
  }
}

function handleCanvasClick(event: RuntimeUiClickEvent): void {
  if (noteClickLocked) {
    return
  }
  const role = extractRole(event.actor, event.data)
  if (role !== undefined) {
    hideNotes(role)
  }
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

export function registerExperienceBonusUi(): void {
  if (registered) {
    return
  }
  const scope = ensureUiScope()
  registerButton(scope, "双倍经验BUFF", handleDoubleExpButtonClick, "exp_bonus_double_button")
  registerButton(scope, "在线提升", handleOnlineButtonClick, "exp_bonus_online_button")
  registerButton(scope, "每日加成%", handleDailyButtonClick, "exp_bonus_daily_button")
  const canvasRegId = scope.registerClick(PANEL_PARENT, handleCanvasClick, { tag: "exp_bonus_canvas_click" })
  if (canvasRegId === null) {
    print(`[${TAG}] canvas click register failed`)
  }
  registered = true
}

function tick(loopGeneration: number): void {
  if (!started || loopGeneration !== generation) {
    return
  }
  const roles = getOnlineRoles()
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]
    if (role !== undefined) {
      tickExperienceBonusOnlineTime(role, TICK_SECONDS)
      tickDoubleExpBuff(role, TICK_SECONDS)
      updateRoleUi(role)
    }
  }
  LuaAPI.call_delay_time(asFixed(TICK_SECONDS), () => tick(loopGeneration))
}

export function startExperienceBonusUiRuntime(): void {
  registerExperienceBonusUi()
  if (started) {
    return
  }
  started = true
  generation += 1
  const roles = getOnlineRoles()
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]
    if (role !== undefined) {
      updateRoleUi(role)
    }
  }
  tick(generation)
}
