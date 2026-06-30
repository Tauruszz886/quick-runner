import { safeCall } from "@common/engine_safe"
import { TriggerHub } from "@common/trigger_hub"

const TAG = "ZLJ_TENTH_VICTORY"

declare const EVENT: {
  ANY_LIFEENTITY_TRIGGER_SPACE: string
}
declare const Enums: { TriggerSpaceEventType: { ENTER: number } }

let finished = false

export function resetTenthVictoryTrigger(): void {
  finished = false
}

function extractTriggerUnit(data: unknown): unknown {
  const eventData = data as { event_unit?: unknown; unit?: unknown } | undefined
  return eventData?.event_unit !== undefined ? eventData.event_unit : eventData?.unit
}

function getUnitRole(unit: unknown, source: string): Role | null {
  return safeCall(
    () => {
      const candidate = unit as any
      if (candidate.get_role !== undefined && candidate.get_role !== null) {
        return candidate.get_role()
      }
      if (candidate.get_ctrl_role !== undefined && candidate.get_ctrl_role !== null) {
        return candidate.get_ctrl_role()
      }
      return null
    },
    { tag: `tenth_victory_get_role_${source}`, fallback: null, logger: print }
  ) as Role | null
}

function finishGameForUnit(unit: unknown, source: string): void {
  if (finished) {
    return
  }
  if (unit === null || unit === undefined) {
    print(`[${TAG}] finish skipped source=${source} unit=nil`)
    return
  }
  const role = getUnitRole(unit, source)
  if (role === null || role === undefined) {
    print(`[${TAG}] finish skipped source=${source} role=nil`)
    return
  }
  finished = true
  safeCall(
    () => {
      role.game_win_and_show_result_panel()
    },
    { tag: `tenth_victory_finish_${source}`, fallback: undefined, logger: print }
  )
  print(`[${TAG}] finish_game source=${source}`)
}

export function registerTenthVictoryTriggerUnit(trigger: unknown, name: string): boolean {
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] trigger register skipped name=${name} trigger=nil`)
    return false
  }
  const triggerId = safeCall(
    () => {
      return (trigger as any).get_id()
    },
    { tag: `tenth_victory_trigger_id_${name}`, fallback: null, logger: print }
  )
  if (triggerId === null || triggerId === undefined) {
    print(`[${TAG}] trigger register skipped name=${name} trigger_id=nil`)
    return false
  }
  TriggerHub.register(
    [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
    (_eventName: unknown, _actor: unknown, data: unknown) =>
      finishGameForUnit(extractTriggerUnit(data), `scene:${name}:${tostring(triggerId)}`),
    {
      safe: true,
      safeCallback: true,
      tag: `tenth_victory_scene_${name}`,
      logger: print,
    }
  )
  print(`[${TAG}] trigger registered name=${name} trigger_id=${triggerId}`)
  return true
}
