import { safeCall } from "@common/engine_safe"
import { WORLD_FLOATING_TEXT_ENABLED } from "./progression_config"

const TAG = "ZLJ_EXP_FLOAT"
const EXP_TEXT_COLOR = 0x85f1ff as Color
const COIN_TEXT_COLOR = 0xffd45a as Color
const TEXT_FONT_SIZE = 40
const EXP_TEXT_DURATION = math.tofixed(0.8)
const COIN_TEXT_DURATION = math.tofixed(1.4)
const TEXT_ANIM_TYPE = 1 as integer
const TEXT_OFFSET = math.Vector3(0, math.tofixed(2.6), 0)

export type WorldFloatPosition = {
  x: number
  y: number
  z: number
}

function asInteger(value: number): integer {
  return math.tointeger(math.floor(value) as unknown as Fixed)
}

function toDynamicTextPosition(position: WorldFloatPosition): Vector3 {
  return math.Vector3(
    (position.x + TEXT_OFFSET.x) as Fixed,
    (position.y + TEXT_OFFSET.y) as Fixed,
    (position.z + TEXT_OFFSET.z) as Fixed
  )
}

function richText(text: string): string {
  return `#f(s:${TEXT_FONT_SIZE})${text}#l`
}

function showWorldFloatingText(role: Role, text: string, position: WorldFloatPosition, color: Color, duration: Fixed, tag: string): void {
  const textPosition = toDynamicTextPosition(position)
  safeCall(
    () => {
      role.show_dynamic_text(richText(text), textPosition, color, duration, TEXT_ANIM_TYPE)
    },
    { tag, fallback: undefined, logger: print }
  )
  print(`[${TAG}] show text=${text} font=${TEXT_FONT_SIZE} pos=(${position.x},${position.y},${position.z})`)
}

export function showExperienceScreenFloatingText(role: Role, amount: number, position: WorldFloatPosition): void {
  if (!WORLD_FLOATING_TEXT_ENABLED || amount <= 0) {
    return
  }
  showWorldFloatingText(role, `+${asInteger(amount)} 经验`, position, EXP_TEXT_COLOR, EXP_TEXT_DURATION, "exp_world_float_show")
}

export function showCoinWorldFloatingText(role: Role, amount: number, position: WorldFloatPosition): void {
  if (!WORLD_FLOATING_TEXT_ENABLED || amount <= 0) {
    return
  }
  showWorldFloatingText(role, `+${asInteger(amount)} 金币`, position, COIN_TEXT_COLOR, COIN_TEXT_DURATION, "coin_world_float_show")
}
