import { ExperienceSourceConfig表, RebirthExpMultiplierConfig索引 } from "../../generated/excel_data"
import { roleKey } from "../runtime/runtime_roles"

const DOUBLE_EXP_BUFF_SECONDS = 300
const ONLINE_BONUS_SECONDS_PER_PERCENT = 60
const ONLINE_BONUS_MAX_PERCENT = 100
const DEFAULT_DAILY_BONUS_PER_STREAK_DAY_PERCENT = 10

type DailyBonusArchiveSnapshot = {
  lastLoginDayIndex: number
  consecutiveDays: number
}

type DailyBonusArchiveAdapter = {
  load: (role: Role) => DailyBonusArchiveSnapshot | undefined
  save: (role: Role, snapshot: DailyBonusArchiveSnapshot) => void
}

type ExperienceBonusState = {
  key: string
  role: Role
  doubleExpBuffRemainingSeconds: number
  onlineSeconds: number
  onlineBonusPercent: number
  dailyBonusPercent: number
  dailyConsecutiveDays: number
  rebirthCount: number
  dailyInitialized: boolean
}

const statesByRole = new Map<string, ExperienceBonusState>()

let dailyArchiveAdapter: DailyBonusArchiveAdapter | undefined
let doubleExpBuffPurchaseHandler: ((role: Role) => boolean) | undefined

export function setDailyBonusArchiveAdapter(adapter: DailyBonusArchiveAdapter): void {
  dailyArchiveAdapter = adapter
}

export function setDoubleExpBuffPurchaseHandler(handler: (role: Role) => boolean): void {
  doubleExpBuffPurchaseHandler = handler
}

function getCurrentDayIndex(): number {
  const api = GameAPI as any
  if (
    api.get_timestamp === undefined ||
    api.get_year === undefined ||
    api.get_month === undefined ||
    api.get_day === undefined
  ) {
    return 0
  }
  const timestamp = api.get_timestamp() as Timestamp
  const year = api.get_year(timestamp) as number
  const month = api.get_month(timestamp) as number
  const day = api.get_day(timestamp) as number
  return toGregorianDayIndex(year, month, day)
}

function isLeapYear(year: number): boolean {
  if (year % 400 === 0) {
    return true
  }
  if (year % 100 === 0) {
    return false
  }
  return year % 4 === 0
}

function daysBeforeYear(year: number): number {
  const previousYear = year - 1
  return previousYear * 365 + math.floor(previousYear / 4) - math.floor(previousYear / 100) + math.floor(previousYear / 400)
}

function daysBeforeMonth(year: number, month: number): number {
  const monthIndex = math.max(1, math.min(12, math.floor(month)))
  let days = 0
  if (monthIndex === 2) {
    days = 31
  } else if (monthIndex === 3) {
    days = 59
  } else if (monthIndex === 4) {
    days = 90
  } else if (monthIndex === 5) {
    days = 120
  } else if (monthIndex === 6) {
    days = 151
  } else if (monthIndex === 7) {
    days = 181
  } else if (monthIndex === 8) {
    days = 212
  } else if (monthIndex === 9) {
    days = 243
  } else if (monthIndex === 10) {
    days = 273
  } else if (monthIndex === 11) {
    days = 304
  } else if (monthIndex === 12) {
    days = 334
  }
  if (monthIndex > 2 && isLeapYear(year)) {
    days += 1
  }
  return days
}

function toGregorianDayIndex(year: number, month: number, day: number): number {
  return daysBeforeYear(year) + daysBeforeMonth(year, month) + math.max(1, math.floor(day))
}

function loadDailySnapshot(role: Role): DailyBonusArchiveSnapshot | undefined {
  if (dailyArchiveAdapter === undefined) {
    return undefined
  }
  return dailyArchiveAdapter.load(role)
}

function saveDailySnapshot(role: Role, snapshot: DailyBonusArchiveSnapshot): void {
  if (dailyArchiveAdapter === undefined) {
    return
  }
  dailyArchiveAdapter.save(role, snapshot)
}

function ensureDailyBonusInitialized(state: ExperienceBonusState): void {
  if (state.dailyInitialized) {
    return
  }
  state.dailyInitialized = true

  const currentDayIndex = getCurrentDayIndex()
  const saved = loadDailySnapshot(state.role)
  let consecutiveDays = 1

  if (saved !== undefined) {
    if (saved.lastLoginDayIndex === currentDayIndex) {
      consecutiveDays = math.max(1, saved.consecutiveDays)
    } else if (saved.lastLoginDayIndex + 1 === currentDayIndex) {
      consecutiveDays = math.max(1, saved.consecutiveDays + 1)
    }
  }

  state.dailyConsecutiveDays = consecutiveDays
  state.dailyBonusPercent = math.max(0, consecutiveDays - 1) * DEFAULT_DAILY_BONUS_PER_STREAK_DAY_PERCENT
  saveDailySnapshot(state.role, { lastLoginDayIndex: currentDayIndex, consecutiveDays })
}

export function getOrCreateExperienceBonusState(role: Role): ExperienceBonusState {
  const key = roleKey(role)
  const existing = statesByRole.get(key)
  if (existing !== undefined) {
    existing.role = role
    ensureDailyBonusInitialized(existing)
    return existing
  }

  const state: ExperienceBonusState = {
    key,
    role,
    doubleExpBuffRemainingSeconds: 0,
    onlineSeconds: 0,
    onlineBonusPercent: 0,
    dailyBonusPercent: 0,
    dailyConsecutiveDays: 1,
    rebirthCount: 0,
    dailyInitialized: false,
  }
  statesByRole.set(key, state)
  ensureDailyBonusInitialized(state)
  return state
}

export function tickExperienceBonusOnlineTime(role: Role, seconds: number): void {
  const state = getOrCreateExperienceBonusState(role)
  state.onlineSeconds += seconds
  const percent = math.floor(state.onlineSeconds / ONLINE_BONUS_SECONDS_PER_PERCENT)
  state.onlineBonusPercent = math.min(ONLINE_BONUS_MAX_PERCENT, percent)
}

export function tickDoubleExpBuff(role: Role, seconds: number): void {
  const state = getOrCreateExperienceBonusState(role)
  if (state.doubleExpBuffRemainingSeconds <= 0) {
    state.doubleExpBuffRemainingSeconds = 0
    return
  }
  state.doubleExpBuffRemainingSeconds = math.max(0, state.doubleExpBuffRemainingSeconds - seconds)
}

export function requestDoubleExpBuff(role: Role): boolean {
  if (doubleExpBuffPurchaseHandler !== undefined && !doubleExpBuffPurchaseHandler(role)) {
    return false
  }
  const state = getOrCreateExperienceBonusState(role)
  state.doubleExpBuffRemainingSeconds = DOUBLE_EXP_BUFF_SECONDS
  return true
}

function findBaseTickConfig(): {
  baseExpPerTick: number
  levelExponent: number
  multiplier: number
  affectedByRebirth: boolean
} {
  for (let i = 0; i < ExperienceSourceConfig表.length; i++) {
    const row = ExperienceSourceConfig表[i]
    if (row !== undefined && row["sourceKind"] === "base_tick") {
      return {
        baseExpPerTick: row["baseExpPerTick"],
        levelExponent: row["levelExponent"],
        multiplier: row["multiplier"],
        affectedByRebirth: row["affectedByRebirth"],
      }
    }
  }
  return { baseExpPerTick: 1, levelExponent: -0.0133, multiplier: 1, affectedByRebirth: true }
}

export function getRebirthExpMultiplier(rebirthCount: number): number {
  const exact = RebirthExpMultiplierConfig索引[tostring(rebirthCount)]
  if (exact !== undefined) {
    return exact["expMultiplier"]
  }
  return 1
}

function getDoubleExpBuffMultiplier(state: ExperienceBonusState): number {
  if (state.doubleExpBuffRemainingSeconds <= 0) {
    return 1
  }
  for (let i = 0; i < ExperienceSourceConfig表.length; i++) {
    const row = ExperienceSourceConfig表[i]
    if (row !== undefined && row["source"] === "BUFF" && row["sourceKind"] === "multiplier") {
      return row["multiplier"]
    }
  }
  return 2
}

export function calculateEffectiveMovementTickExperience(role: Role, level: number): number {
  const state = getOrCreateExperienceBonusState(role)
  const base = findBaseTickConfig()
  const normalizedLevel = math.max(1, level)
  const levelFactor = Math.pow(normalizedLevel, base.levelExponent)
  let multiplier = base.multiplier

  multiplier *= getDoubleExpBuffMultiplier(state)
  multiplier *= 1 + state.onlineBonusPercent / 100
  multiplier *= 1 + state.dailyBonusPercent / 100
  if (base.affectedByRebirth) {
    multiplier *= getRebirthExpMultiplier(state.rebirthCount)
  }

  return math.max(1, math.floor(base.baseExpPerTick * levelFactor * multiplier + 0.5))
}

export function getDoubleExpBuffRemainingSeconds(role: Role): number {
  return getOrCreateExperienceBonusState(role).doubleExpBuffRemainingSeconds
}

export function getOnlineBonusPercent(role: Role): number {
  return getOrCreateExperienceBonusState(role).onlineBonusPercent
}

export function getDailyBonusPercent(role: Role): number {
  return getOrCreateExperienceBonusState(role).dailyBonusPercent
}

export function getDailyConsecutiveDays(role: Role): number {
  return getOrCreateExperienceBonusState(role).dailyConsecutiveDays
}

export function getRebirthCount(role: Role): number {
  return getOrCreateExperienceBonusState(role).rebirthCount
}

export function setRebirthCount(role: Role, rebirthCount: number): void {
  const state = getOrCreateExperienceBonusState(role)
  state.rebirthCount = math.max(0, math.floor(rebirthCount))
}
