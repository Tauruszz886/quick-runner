import { safeCall } from "@common/engine_safe"
import { UINodes } from "../../generated/exported_data"
import {
  FLOATING_TEXT_FADE_SECONDS,
  FLOATING_TEXT_ENABLED,
  FLOATING_TEXT_VISIBLE_SECONDS,
  PROGRESS_BAR_MAX,
  PROGRESSION_TAG,
} from "./progression_config"
import type { PlayerProgressState } from "./progression_state"

const LEVEL_LABEL = UINodes["等级"] as ELabel
const EXP_LABEL = UINodes["经验"] as ELabel
const SPEED_LABEL = UINodes["速度"] as ELabel
const EXP_PROGRESS = UINodes["经验进度"] as EProgressbar
const EXP_FLOAT_LABEL = UINodes["经验飘字文本"] as ELabel
const COIN_FLOAT_LABEL = UINodes["金币飘字文本"] as ELabel

const expFloatGenerationByRole = new Map<string, number>()
const coinFloatGenerationByRole = new Map<string, number>()

function asInteger(value: number): integer {
  return math.tointeger(math.floor(value) as unknown as Fixed)
}

function scheduleDelay(seconds: number, callback: () => void): void {
  ;(LuaAPI as any).call_delay_time(seconds as Fixed, callback)
}

function writeLabel(role: Role, label: ELabel, text: string, tag: string): void {
  safeCall(
    () => {
      role.set_label_text(label, text)
    },
    { tag, fallback: undefined, logger: print }
  )
}

function setVisible(role: Role, node: ENode, visible: boolean, tag: string): void {
  safeCall(
    () => {
      role.set_node_visible(node, visible)
    },
    { tag, fallback: undefined, logger: print }
  )
}

function setOpacity(role: Role, node: ENode, opacity: number, tag: string): void {
  safeCall(
    () => {
      role.set_ui_opacity(node, opacity as Fixed)
    },
    { tag, fallback: undefined, logger: print }
  )
}

export function initializeProgressionUi(role: Role): void {
  safeCall(
    () => {
      role.set_progressbar_min(EXP_PROGRESS, 0 as integer)
      role.set_progressbar_max(EXP_PROGRESS, PROGRESS_BAR_MAX as integer)
      role.set_progressbar_current(EXP_PROGRESS, 0 as integer)
    },
    { tag: "progression_ui_init_progressbar", fallback: undefined, logger: print }
  )
}

export function updateProgressionUi(role: Role, state: PlayerProgressState): void {
  const progress = state.levelProgress
  const current = asInteger(progress.currentInLevel)
  const required = asInteger(progress.requiredForNext)
  const progressValue = asInteger(progress.ratio * PROGRESS_BAR_MAX)

  writeLabel(role, LEVEL_LABEL, `Lv.${progress.level}`, "progression_ui_level")
  writeLabel(role, EXP_LABEL, `${current}/${required}`, "progression_ui_exp")
  writeLabel(role, SPEED_LABEL, `速度：${tostring(asInteger(state.speed))}`, "progression_ui_speed")
  safeCall(
    () => {
      role.set_progressbar_current(EXP_PROGRESS, progressValue as integer)
    },
    { tag: "progression_ui_progress", fallback: undefined, logger: print }
  )
}

function showFloatingText(
  role: Role,
  key: string,
  label: ELabel,
  text: string,
  generationMap: Map<string, number>,
  tagPrefix: string
): void {
  const currentGeneration = generationMap.get(key)
  const nextGeneration = (currentGeneration !== undefined ? currentGeneration : 0) + 1
  generationMap.set(key, nextGeneration)
  writeLabel(role, label, text, `${tagPrefix}_text`)
  setOpacity(role, label, 1, `${tagPrefix}_opacity_show`)
  setVisible(role, label, true, `${tagPrefix}_visible_show`)

  scheduleDelay(FLOATING_TEXT_VISIBLE_SECONDS, () => {
    if (generationMap.get(key) !== nextGeneration) {
      return
    }
    setOpacity(role, label, 0.25, `${tagPrefix}_opacity_fade`)
    scheduleDelay(FLOATING_TEXT_FADE_SECONDS, () => {
      if (generationMap.get(key) !== nextGeneration) {
        return
      }
      setVisible(role, label, false, `${tagPrefix}_visible_hide`)
      setOpacity(role, label, 1, `${tagPrefix}_opacity_reset`)
    })
  })
}

export function showExperienceFloatingText(role: Role, key: string, amount: number): void {
  if (!FLOATING_TEXT_ENABLED) {
    return
  }
  if (amount <= 0) {
    return
  }
  showFloatingText(role, key, EXP_FLOAT_LABEL, `+${asInteger(amount)} EXP`, expFloatGenerationByRole, "progression_exp_float")
}

export function showCoinFloatingText(role: Role, key: string, amount: number): void {
  if (!FLOATING_TEXT_ENABLED) {
    return
  }
  if (amount <= 0) {
    return
  }
  showFloatingText(role, key, COIN_FLOAT_LABEL, `+${asInteger(amount)} 金币`, coinFloatGenerationByRole, "progression_coin_float")
}

export function logProgressionUiReady(): void {
  print(
    `[${PROGRESSION_TAG}] ui ready level=等级 exp=经验 progress=经验进度 speed=速度 exp_float=经验飘字文本 coin_float=金币飘字文本`
  )
}
