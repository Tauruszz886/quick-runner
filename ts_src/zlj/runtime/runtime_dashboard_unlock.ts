import { safeCall } from "@common/engine_safe"
import { TriggerHub } from "@common/trigger_hub"
import { getOnlineRoles } from "./runtime_roles"

const TAG = "ZLJ_DASHBOARD_UNLOCK"
const CANVAS_2_NODE_ID = "1960838312"
const UI_ROOT_NODE_ID = "1519736575"
const BUTTON_A_NODE_NAME = "圆形金"
const BUTTON_B_NODE_NAME = "圆形蓝"
const BUTTON_A_NODE_ID = "1123301873"
const BUTTON_B_NODE_ID = "1942228679"
const BUTTON_A_FULL_NODE_ID = `${UI_ROOT_NODE_ID}|${BUTTON_A_NODE_ID}`
const BUTTON_B_FULL_NODE_ID = `${UI_ROOT_NODE_ID}|${BUTTON_B_NODE_ID}`
const BUTTON_A_REQUIRED_COUNT = 3
const BUTTON_B_REQUIRED_COUNT = 3
const TOUCH_EVENT_TYPES = [0, 1, 2, 3] as const
const CLICK_LOCK_SECONDS = 0.08
const TIP_SECONDS = 1.2
const GLOBAL_CLICK_LOG_LIMIT = 20
const SETUP_RETRY_LIMIT = 3

declare const EVENT: {
  EUI_NODE_TOUCH_EVENT: string
}

let registered = false
let unlocked = false
let buttonACount = 0
let buttonBCount = 0
let buttonALocked = false
let buttonBLocked = false
let setupScheduled = false
let setupRetryCount = 0
let globalClickLogCount = 0

function buttonNode(nodeId: string): EButton {
  return nodeId as unknown as EButton
}

function isValidNode(node: unknown): boolean {
  if (node === undefined || node === null) {
    return false
  }
  const text = tostring(node)
  return text !== "" && text !== "nil" && text !== "0"
}

function queryButtonNode(name: string): EButton | undefined {
  const node = safeCall(
    () => {
      return LuaAPI.query_ui_node(name) as EButton
    },
    { tag: `dashboard_unlock_query_${name}`, fallback: undefined, logger: print }
  )
  if (!isValidNode(node)) {
    print(`[${TAG}] query button failed name=${name}`)
    return undefined
  }
  print(`[${TAG}] query button ok name=${name} node=${tostring(node)}`)
  return node
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

function showTips(actor: unknown, data: unknown, content: string): void {
  const role = extractRole(actor, data)
  if (role !== undefined && role !== null) {
    const ok = safeCall(
      () => {
        role.show_tips(content, math.tofixed(TIP_SECONDS))
        return true
      },
      { tag: `dashboard_unlock_role_tips`, fallback: false, logger: print }
    )
    if (ok === true) {
      print(`[${TAG}] tips role content=${content}`)
      return
    }
  }
  safeCall(
    () => {
      GlobalAPI.show_tips(content, math.tofixed(TIP_SECONDS))
    },
    { tag: "dashboard_unlock_global_tips", fallback: undefined, logger: print }
  )
}

function normalizeNodeText(value: unknown): string {
  if (value === undefined || value === null) {
    return ""
  }
  return tostring(value)
}

function isButtonANode(value: unknown, queriedNode?: EButton): boolean {
  const text = normalizeNodeText(value)
  return (
    value === queriedNode ||
    text === BUTTON_A_NODE_ID ||
    text === BUTTON_A_FULL_NODE_ID ||
    text === normalizeNodeText(queriedNode)
  )
}

function isButtonBNode(value: unknown, queriedNode?: EButton): boolean {
  const text = normalizeNodeText(value)
  return (
    value === queriedNode ||
    text === BUTTON_B_NODE_ID ||
    text === BUTTON_B_FULL_NODE_ID ||
    text === normalizeNodeText(queriedNode)
  )
}

function extractEventNode(actor: unknown, data: unknown): unknown {
  const eventData = data as { eui_node_id?: unknown; node?: unknown; eui_node?: unknown } | undefined
  if (eventData?.eui_node_id !== undefined) {
    return eventData.eui_node_id
  }
  if (eventData?.node !== undefined) {
    return eventData.node
  }
  if (eventData?.eui_node !== undefined) {
    return eventData.eui_node
  }
  return actor
}

function handleGlobalEuiClick(
  buttonANode: EButton,
  buttonBNode: EButton,
  enableDashboard: () => void,
  _eventName: unknown,
  actor: unknown,
  data: unknown
): void {
  const clickedNode = extractEventNode(actor, data)
  if (globalClickLogCount < GLOBAL_CLICK_LOG_LIMIT) {
    globalClickLogCount += 1
    print(`[${TAG}] global_eui_click node=${normalizeNodeText(clickedNode)} actor=${tostring(actor)} data=${tostring(data)}`)
  }
  if (isButtonANode(clickedNode, buttonANode)) {
    withClickLock("a", () => handleButtonA(actor, data))
    return
  }
  if (isButtonBNode(clickedNode, buttonBNode)) {
    withClickLock("b", () => handleButtonB(enableDashboard, actor, data))
  }
}

function enableButtonTouchForRole(role: Role, node: EButton, tag: string): void {
  safeCall(
    () => {
      role.set_node_visible(node, true)
    },
    { tag: `dashboard_unlock_visible_${tag}`, fallback: undefined, logger: print }
  )
  safeCall(
    () => {
      role.set_button_enabled(node, true)
    },
    { tag: `dashboard_unlock_button_enabled_${tag}`, fallback: undefined, logger: print }
  )
  safeCall(
    () => {
      role.set_node_touch_enabled(node, true)
    },
    { tag: `dashboard_unlock_touch_enabled_${tag}`, fallback: undefined, logger: print }
  )
}

function enableButtonTouchForOnlineRoles(buttonANode: EButton, buttonBNode: EButton): void {
  const roles = getOnlineRoles()
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]
    if (role === undefined) {
      continue
    }
    enableButtonTouchForRole(role, buttonANode, BUTTON_A_NODE_NAME)
    enableButtonTouchForRole(role, buttonBNode, BUTTON_B_NODE_NAME)
  }
  print(`[${TAG}] touch enabled roles=${roles.length} button_a=${BUTTON_A_NODE_NAME}:${tostring(buttonANode)} button_b=${BUTTON_B_NODE_NAME}:${tostring(buttonBNode)}`)
}

function withClickLock(button: "a" | "b", handler: () => void): void {
  if (button === "a") {
    if (buttonALocked) {
      return
    }
    buttonALocked = true
    handler()
    LuaAPI.call_delay_time(math.tofixed(CLICK_LOCK_SECONDS), () => {
      buttonALocked = false
    })
    return
  }
  if (buttonBLocked) {
    return
  }
  buttonBLocked = true
  handler()
  LuaAPI.call_delay_time(math.tofixed(CLICK_LOCK_SECONDS), () => {
    buttonBLocked = false
  })
}

function resetSequence(reason: string): void {
  buttonACount = 0
  buttonBCount = 0
  print(`[${TAG}] reset reason=${reason}`)
}

function handleButtonA(actor: unknown, data: unknown): void {
  if (unlocked) {
    print(`[${TAG}] click_a ignored unlocked=true`)
    showTips(actor, data, "点击A按钮成功")
    return
  }
  if (buttonBCount > 0) {
    resetSequence("a_after_b")
  }
  buttonACount = math.min(buttonACount + 1, BUTTON_A_REQUIRED_COUNT)
  showTips(actor, data, "点击A按钮成功")
  print(`[${TAG}] click_a a=${buttonACount}/${BUTTON_A_REQUIRED_COUNT} b=${buttonBCount}/${BUTTON_B_REQUIRED_COUNT}`)
}

function handleButtonB(enableDashboard: () => void, actor: unknown, data: unknown): void {
  if (unlocked) {
    print(`[${TAG}] click_b ignored unlocked=true`)
    showTips(actor, data, "点击B按钮成功")
    return
  }
  if (buttonACount < BUTTON_A_REQUIRED_COUNT) {
    resetSequence("b_before_a_ready")
    showTips(actor, data, "点击B按钮成功")
    return
  }
  buttonBCount = math.min(buttonBCount + 1, BUTTON_B_REQUIRED_COUNT)
  showTips(actor, data, "点击B按钮成功")
  print(`[${TAG}] click_b a=${buttonACount}/${BUTTON_A_REQUIRED_COUNT} b=${buttonBCount}/${BUTTON_B_REQUIRED_COUNT}`)
  if (buttonBCount < BUTTON_B_REQUIRED_COUNT) {
    return
  }
  unlocked = true
  enableDashboard()
  print(`[${TAG}] dashboard unlocked sequence=a3_b2`)
}

export function registerDashboardUnlockButtons(enableDashboard: () => void): void {
  if (registered) {
    return
  }
  if (setupScheduled) {
    return
  }
  setupScheduled = true
  LuaAPI.call_delay_time(math.tofixed(1), () => setupDashboardUnlockButtons(enableDashboard))
  print(`[${TAG}] setup scheduled delay=1`)
}

function setupDashboardUnlockButtons(enableDashboard: () => void): void {
  if (registered) {
    return
  }
  const buttonANode = queryButtonNode(BUTTON_A_NODE_NAME)
  const buttonBNode = queryButtonNode(BUTTON_B_NODE_NAME)
  if (buttonANode === undefined || buttonBNode === undefined) {
    setupScheduled = false
    setupRetryCount += 1
    if (setupRetryCount >= SETUP_RETRY_LIMIT) {
      print(`[${TAG}] setup disabled reason=query_failed retries=${setupRetryCount}`)
      return
    }
    LuaAPI.call_delay_time(math.tofixed(1), () => registerDashboardUnlockButtons(enableDashboard))
    print(`[${TAG}] setup retry scheduled reason=query_failed retry=${setupRetryCount}/${SETUP_RETRY_LIMIT}`)
    return
  }
  registered = true
  setupRetryCount = 0
  enableButtonTouchForOnlineRoles(buttonANode, buttonBNode)
  const scopeId = TriggerHub.createScope("dashboard-unlock")
  registerButtonEvents(scopeId, buttonANode, "a_query", (_eventName, actor, data) => withClickLock("a", () => handleButtonA(actor, data)))
  registerButtonEvents(scopeId, buttonBNode, "b_query", (_eventName, actor, data) => withClickLock("b", () => handleButtonB(enableDashboard, actor, data)))
  TriggerHub.register(
    [EVENT.EUI_NODE_TOUCH_EVENT],
    (eventName: unknown, actor: unknown, data: unknown) =>
      handleGlobalEuiClick(buttonANode, buttonBNode, enableDashboard, eventName, actor, data),
    {
      scopeId,
      safe: true,
      safeCallback: true,
      tag: "dashboard_unlock_global_eui_click",
      logger: print,
    }
  )
  print(
    `[${TAG}] registered canvas=画布2 canvas_id=${CANVAS_2_NODE_ID} ui_root=${UI_ROOT_NODE_ID} button_a=${BUTTON_A_NODE_NAME}:${tostring(buttonANode)}|${BUTTON_A_NODE_ID}|${BUTTON_A_FULL_NODE_ID} need_a=${BUTTON_A_REQUIRED_COUNT} button_b=${BUTTON_B_NODE_NAME}:${tostring(buttonBNode)}|${BUTTON_B_NODE_ID}|${BUTTON_B_FULL_NODE_ID} need_b=${BUTTON_B_REQUIRED_COUNT} touch_types=0,1,2,3 global_listener=true`
  )
}

function registerButtonEvents(scopeId: number, node: EButton | string, tag: string, handler: (...args: unknown[]) => void): void {
  const euiNode = typeof node === "string" ? buttonNode(node) : node
  for (let i = 0; i < TOUCH_EVENT_TYPES.length; i++) {
    const touchEventType = TOUCH_EVENT_TYPES[i]! as ENodeTouchEventType
    TriggerHub.register([EVENT.EUI_NODE_TOUCH_EVENT, euiNode, touchEventType], handler, {
      scopeId,
      safe: true,
      safeCallback: true,
      tag: `dashboard_unlock_button_${tag}_typed_${touchEventType}`,
      logger: print,
    })
  }
  TriggerHub.register([EVENT.EUI_NODE_TOUCH_EVENT, euiNode], handler, {
    scopeId,
    safe: true,
    safeCallback: true,
    tag: `dashboard_unlock_button_${tag}`,
    logger: print,
  })
}

export function printDashboardUnlockDebugSummary(source: string): void {
  print(
    `[${TAG}] debug source=${source} scheduled=${setupScheduled} registered=${registered} unlocked=${unlocked} a=${buttonACount}/${BUTTON_A_REQUIRED_COUNT} b=${buttonBCount}/${BUTTON_B_REQUIRED_COUNT} button_a=${BUTTON_A_NODE_NAME}|${BUTTON_A_NODE_ID}|${BUTTON_A_FULL_NODE_ID} button_b=${BUTTON_B_NODE_NAME}|${BUTTON_B_NODE_ID}|${BUTTON_B_FULL_NODE_ID}`
  )
}
