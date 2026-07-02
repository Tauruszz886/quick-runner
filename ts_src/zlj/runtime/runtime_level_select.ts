import { safeCall } from "@common/engine_safe"
import { RuntimeUiScope, type MenuFlyout, type MenuFlyoutItem, type RuntimeUiClickEvent } from "@common/runtime_ui"
import { UINodes } from "../../generated/exported_data"
import { BIRTH_SPAWN_Y } from "../config"
import { asFixed } from "../layout"
import { getOnlineRoles } from "./runtime_roles"

const TAG = "ZLJ_LEVEL_SELECT"
const SELECT_BUTTON_NAME = "关卡选择"
const PANEL_PARENT = UINodes["画布0"] as ENode
const CLICK_LOCK_SECONDS = 0.12
const MENU_WIDTH = 260
const MENU_ITEM_HEIGHT = 40
const MENU_ITEM_GAP = 6
const MENU_PADDING = 10
const MENU_HEIGHT = MENU_PADDING * 2 + MENU_ITEM_HEIGHT * 10 + MENU_ITEM_GAP * 9

type LevelTeleportTarget = {
  unit: unknown
  x: number
  y: number
  z: number
}

let registered = false
let menuVisible = false
let clickLocked = false
let uiScope: RuntimeUiScope | undefined
let levelMenu: MenuFlyout | null = null

const CHINESE_LEVEL_NUMBERS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"] as const
const LEVEL_ITEM_IDS: Record<string, number> = {}
const LEVEL_MENU_ITEMS: MenuFlyoutItem[] = []

for (let level = 1; level <= 10; level++) {
  const text = `第${CHINESE_LEVEL_NUMBERS[level - 1]}关`
  const id = `level_${level}`
  LEVEL_ITEM_IDS[id] = level
  LEVEL_MENU_ITEMS.push({ id, text })
}

function nodeText(node: unknown): string {
  if (node === undefined || node === null) {
    return ""
  }
  return tostring(node)
}

function sameNode(a: unknown, b: unknown): boolean {
  return a === b || nodeText(a) === nodeText(b)
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

function getRoleCharacter(role: Role | undefined, source: string): unknown {
  if (role === undefined || role === null) {
    return null
  }
  return safeCall(
    () => {
      return (role as any).get_ctrl_unit()
    },
    { tag: `level_select_get_ctrl_${source}`, fallback: null, logger: print }
  )
}

function withClickLock(handler: () => void): void {
  if (clickLocked) {
    return
  }
  clickLocked = true
  handler()
  LuaAPI.call_delay_time(asFixed(CLICK_LOCK_SECONDS), () => {
    clickLocked = false
  })
}

function levelTeleportName(level: number): string {
  return `第${CHINESE_LEVEL_NUMBERS[level - 1]}关传送点`
}

function queryUnitByName(name: string): unknown {
  return safeCall(
    () => {
      return (LuaAPI as any).query_unit(name)
    },
    { tag: `level_select_query_${name}`, fallback: null, logger: print }
  )
}

function getVector3(unit: unknown, methodName: "get_position" | "get_scale", tag: string): { x: number; y: number; z: number } | null {
  const value = safeCall(
    () => {
      const target = unit as any
      if (target[methodName] === undefined || target[methodName] === null) {
        return null
      }
      return target[methodName]()
    },
    { tag, fallback: null, logger: print }
  ) as { x?: number; y?: number; z?: number } | null
  if (value === null || value === undefined || value.x === undefined || value.y === undefined || value.z === undefined) {
    return null
  }
  return { x: value.x, y: value.y, z: value.z }
}

function findLevelTeleportTarget(level: number): LevelTeleportTarget | null {
  const name = levelTeleportName(level)
  let unit = queryUnitByName(name)
  if (unit === null || unit === undefined) {
    unit = queryUnitByName(`QR_${name}`)
  }
  if (unit === null || unit === undefined) {
    print(`[${TAG}] teleport target missing level=${level} name=${name}`)
    return null
  }

  const position = getVector3(unit, "get_position", `level_select_position_${level}`)
  if (position === null) {
    print(`[${TAG}] teleport target missing position level=${level} name=${name}`)
    return null
  }

  const scale = getVector3(unit, "get_scale", `level_select_scale_${level}`)
  const landingY = scale === null ? BIRTH_SPAWN_Y : position.y + scale.y / 2
  return {
    unit,
    x: position.x,
    y: landingY,
    z: position.z,
  }
}

function teleportRoleToLevel(role: Role | undefined, level: number): void {
  const fallbackRole = role === undefined ? getOnlineRoles()[0] : role
  const character = getRoleCharacter(fallbackRole, `level_${level}`)
  if (character === null || character === undefined) {
    print(`[${TAG}] teleport skipped level=${level} character=nil`)
    return
  }

  const target = findLevelTeleportTarget(level)
  if (target === null) {
    return
  }

  safeCall(
    () => {
      ;(character as any).set_position(math.Vector3(target.x as Fixed, target.y as Fixed, target.z as Fixed))
    },
    { tag: `level_select_teleport_${level}`, fallback: undefined, logger: print }
  )
  print(`[${TAG}] teleport level=${level} pos=${target.x},${target.y},${target.z}`)
}

function ensureMenu(): MenuFlyout | null {
  if (levelMenu !== null) {
    return levelMenu
  }
  const scope = ensureUiScope()
  if (scope === null) {
    return null
  }

  levelMenu = scope.createMenuFlyout(
    "QR关卡选择MenuFlyout",
    {
      x: 450,
      y: 330,
      width: MENU_WIDTH,
      height: MENU_HEIGHT,
    },
    LEVEL_MENU_ITEMS,
    {
      itemHeight: MENU_ITEM_HEIGHT,
      itemGap: MENU_ITEM_GAP,
      paddingX: MENU_PADDING,
      paddingY: MENU_PADDING,
      closeOnSelect: true,
      dismissOnOutsideClick: true,
      panelStyle: {
        imageKey: 10051 as ImageKey,
        opacity: 0.92,
      },
      backdropStyle: {
        imageKey: 10051 as ImageKey,
        opacity: 0.18,
        touchEnabled: true,
      },
      buttonStyle: {
        buttonStyle: {
          normalImageKey: 10051 as ImageKey,
          pressedImageKey: 10052 as ImageKey,
          disabledImageKey: 10100 as ImageKey,
          fontSize: 20,
          textColor: 0xffffff as Color,
        },
      },
    }
  )

  if (levelMenu === null) {
    print(`[${TAG}] create MenuFlyout failed`)
    return null
  }
  levelMenu.setOnSelect((event) => {
    const level = LEVEL_ITEM_IDS[event.item.id]
    if (level === undefined) {
      return
    }
    menuVisible = false
    teleportRoleToLevel(extractRole(event.clickEvent.actor, event.clickEvent.data), level)
  })
  levelMenu.setOnOutsideClick((_event: RuntimeUiClickEvent) => {
    menuVisible = false
  })
  return levelMenu
}

function setMenuVisible(visible: boolean): void {
  const menu = ensureMenu()
  if (menu === null) {
    return
  }
  menuVisible = visible
  if (visible) {
    menu.show()
  } else {
    menu.hide()
  }
}

function handleOpenButtonClick(_eventName: unknown, _actor: unknown, _data: unknown): void {
  withClickLock(() => {
    setMenuVisible(!menuVisible)
  })
}

function ensureUiScope(): RuntimeUiScope | null {
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

export function registerLevelSelectUi(): void {
  if (registered) {
    return
  }
  const scope = ensureUiScope()
  if (scope === null) {
    print(`[${TAG}] register skipped reason=scope_missing`)
    return
  }
  const button = scope.getOrginButton(SELECT_BUTTON_NAME)
  if (button === null) {
    print(`[${TAG}] register skipped reason=button_missing name=${SELECT_BUTTON_NAME}`)
    return
  }
  button.applyStyle({ enabled: true, touchEnabled: true })
  button.setVisible(true)
  const regId = button.onClick((event: RuntimeUiClickEvent) => {
    handleOpenButtonClick(event.eventName, event.actor, event.data)
  }, { tag: "level_select_open" })
  if (regId === null) {
    print(`[${TAG}] register skipped reason=on_click_failed name=${SELECT_BUTTON_NAME}`)
    return
  }
  registered = true
}
