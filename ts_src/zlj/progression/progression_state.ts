import { roleKey } from "../runtime/runtime_roles"
import { calculateLevelProgress, calculateTemporarySpeed, type LevelProgress } from "./experience_table"

export type HorizontalPosition = {
  x: number
  y?: number
  z: number
}

export type PlayerProgressState = {
  role: Role
  key: string
  totalExp: number
  levelProgress: LevelProgress
  speed: number
  lastPosition?: HorizontalPosition
}

const statesByRole = new Map<string, PlayerProgressState>()

export function getOrCreateProgressState(role: Role): PlayerProgressState {
  const key = roleKey(role)
  const existing = statesByRole.get(key)
  if (existing !== undefined) {
    existing.role = role
    return existing
  }

  const levelProgress = calculateLevelProgress(0)
  const state: PlayerProgressState = {
    role,
    key,
    totalExp: 0,
    levelProgress,
    speed: calculateTemporarySpeed(levelProgress.level),
  }
  statesByRole.set(key, state)
  return state
}

export function addExperience(state: PlayerProgressState, amount: number): boolean {
  if (amount <= 0) {
    return false
  }
  const previousLevel = state.levelProgress.level
  state.totalExp += amount
  state.levelProgress = calculateLevelProgress(state.totalExp)
  state.speed = calculateTemporarySpeed(state.levelProgress.level)
  return state.levelProgress.level !== previousLevel
}

export function setLastPosition(state: PlayerProgressState, position: HorizontalPosition): void {
  state.lastPosition = position
}
