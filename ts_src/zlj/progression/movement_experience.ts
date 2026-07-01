import { safeCall } from "@common/engine_safe"
import { toNumber as coerceNumber } from "@common/num"
import { getOnlineRoles, roleKey } from "../runtime/runtime_roles"
import { setQuickRunnerSpeed } from "../runtime/runtime_speed"
import {
  MOVEMENT_EXP_MAX_DISTANCE_PER_TICK,
  MOVEMENT_EXP_MAX_PER_SECOND,
  MOVEMENT_EXP_MIN_DISTANCE,
  MOVEMENT_EXP_PER_WORLD_UNIT,
  MOVEMENT_EXP_TICK_SECONDS,
  PROGRESSION_TAG,
} from "./progression_config"
import { addExperience, getOrCreateProgressState, setLastPosition, type HorizontalPosition } from "./progression_state"
import {
  initializeProgressionUi,
  logProgressionUiReady,
  showExperienceFloatingText,
  updateProgressionUi,
} from "./progression_ui"
import { showExperienceScreenFloatingText } from "./screen_experience_float"
import type { WorldFloatPosition } from "./screen_experience_float"

let started = false
let generation = 0
const initializedRoles = new Map<string, boolean>()

function toNumber(value: unknown): number | undefined {
  return coerceNumber(value, { mode: "loose", ctx: "progression_position", logger: print })
}

function getRolePosition(role: Role): WorldFloatPosition | null {
  const character = safeCall(
    () => {
      return (role as any).get_ctrl_unit()
    },
    { tag: "progression_get_ctrl_unit", fallback: null, logger: print }
  ) as Character | null
  if (character === null || character === undefined) {
    return null
  }
  const position = safeCall(
    () => {
      return (character as any).get_position()
    },
    { tag: "progression_get_position", fallback: null, logger: print }
  ) as Vector3 | null
  if (position === null || position === undefined) {
    return null
  }
  const x = toNumber(position.x)
  const y = toNumber(position.y)
  const z = toNumber(position.z)
  if (x === undefined || y === undefined || z === undefined) {
    return null
  }
  return { x, y, z }
}

function horizontalDistance(a: HorizontalPosition, b: HorizontalPosition): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return math.sqrt(dx * dx + dz * dz)
}

function calculateMovementExp(distance: number): number {
  const raw = math.max(1, math.floor(distance * MOVEMENT_EXP_PER_WORLD_UNIT))
  const cap = MOVEMENT_EXP_MAX_PER_SECOND * MOVEMENT_EXP_TICK_SECONDS
  return math.min(raw, cap)
}

function ensureRoleInitialized(role: Role): void {
  const key = roleKey(role)
  if (initializedRoles.get(key) === true) {
    return
  }
  const state = getOrCreateProgressState(role)
  initializeProgressionUi(role)
  updateProgressionUi(role, state)
  setQuickRunnerSpeed(state.speed)
  initializedRoles.set(key, true)
  print(`[${PROGRESSION_TAG}] role initialized key=${key} level=${state.levelProgress.level} speed=${state.speed}`)
}

function tickRole(role: Role): void {
  ensureRoleInitialized(role)
  const state = getOrCreateProgressState(role)
  const position = getRolePosition(role)
  if (position === null) {
    return
  }

  if (state.lastPosition === undefined) {
    setLastPosition(state, position)
    return
  }

  const distance = horizontalDistance(position, state.lastPosition)
  setLastPosition(state, position)
  if (distance < MOVEMENT_EXP_MIN_DISTANCE) {
    return
  }
  if (distance > MOVEMENT_EXP_MAX_DISTANCE_PER_TICK) {
    print(`[${PROGRESSION_TAG}] movement skipped reason=teleport key=${state.key} distance=${distance}`)
    return
  }

  const gainedExp = calculateMovementExp(distance)
  if (gainedExp <= 0) {
    return
  }
  const leveled = addExperience(state, gainedExp)
  updateProgressionUi(role, state)
  showExperienceFloatingText(role, state.key, gainedExp)
  showExperienceScreenFloatingText(role, gainedExp, position)
  print(
    `[${PROGRESSION_TAG}] exp add key=${state.key} distance=${distance} gained=${gainedExp} total=${state.totalExp} level=${state.levelProgress.level}`
  )
  if (leveled) {
    setQuickRunnerSpeed(state.speed)
    print(`[${PROGRESSION_TAG}] level up key=${state.key} level=${state.levelProgress.level} speed=${state.speed}`)
  }
}

function tickLoop(loopGeneration: number): void {
  if (!started || loopGeneration !== generation) {
    return
  }
  const roles = getOnlineRoles()
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]
    if (role !== undefined) {
      tickRole(role)
    }
  }
  ;(LuaAPI as any).call_delay_time(MOVEMENT_EXP_TICK_SECONDS as Fixed, () => tickLoop(loopGeneration))
}

export function startMovementExperienceRuntime(): void {
  if (started) {
    return
  }
  started = true
  generation += 1
  logProgressionUiReady()
  print(
    `[${PROGRESSION_TAG}] start movement_exp_tick=${MOVEMENT_EXP_TICK_SECONDS}s exp_per_unit=${MOVEMENT_EXP_PER_WORLD_UNIT} max_exp_per_second=${MOVEMENT_EXP_MAX_PER_SECOND}`
  )
  tickLoop(generation)
}
