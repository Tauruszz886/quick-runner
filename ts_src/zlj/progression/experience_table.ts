import { ExperienceLevelConfig表 } from "../../generated/excel_data"
import { TEMP_BASE_SPEED, TEMP_MAX_SPEED, TEMP_SPEED_PER_LEVEL } from "./progression_config"

export type LevelProgress = {
  level: number
  levelStartExp: number
  nextLevelExp: number
  currentInLevel: number
  requiredForNext: number
  ratio: number
  isMaxLevel: boolean
}

function clampRatio(value: number): number {
  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }
  return value
}

function getRowsCount(): number {
  return ExperienceLevelConfig表.length
}

export function calculateLevelProgress(totalExp: number): LevelProgress {
  const rows = ExperienceLevelConfig表
  const count = getRowsCount()
  if (count <= 0) {
    return {
      level: 1,
      levelStartExp: 0,
      nextLevelExp: 1,
      currentInLevel: 0,
      requiredForNext: 1,
      ratio: 0,
      isMaxLevel: true,
    }
  }

  let passedRows = 0
  for (let i = 0; i < count; i++) {
    const row = rows[i]!
    if (totalExp >= row.total_exp) {
      passedRows = i + 1
    } else {
      break
    }
  }

  const maxLevel = rows[count - 1]!.level
  const level = math.min(passedRows + 1, maxLevel)
  const isMaxLevel = level >= maxLevel && totalExp >= rows[count - 1]!.total_exp
  const previousRow = passedRows > 0 ? rows[passedRows - 1]! : undefined
  const nextRow = passedRows < count ? rows[passedRows]! : undefined
  const levelStartExp = previousRow !== undefined ? previousRow.total_exp : 0
  const nextLevelExp = nextRow !== undefined ? nextRow.total_exp : levelStartExp
  const requiredForNext = math.max(nextLevelExp - levelStartExp, 1)
  const currentInLevel = isMaxLevel ? requiredForNext : math.max(totalExp - levelStartExp, 0)

  return {
    level,
    levelStartExp,
    nextLevelExp,
    currentInLevel,
    requiredForNext,
    ratio: isMaxLevel ? 1 : clampRatio(currentInLevel / requiredForNext),
    isMaxLevel,
  }
}

export function calculateTemporarySpeed(level: number): number {
  return math.min(TEMP_BASE_SPEED + math.max(level - 1, 0) * TEMP_SPEED_PER_LEVEL, TEMP_MAX_SPEED)
}
