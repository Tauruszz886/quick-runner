import { safeCall } from "@common/engine_safe"
import { TriggerHub } from "@common/trigger_hub"
import { eliminateUnitAndRebirthAtBirth } from "../birth/rebirth"

const TAG = "ZLJ_HOLE_DEATH"
const BIG_FLOOR_TOP_Y = 3
const WALKABLE_TOP_Y = 6.5
const TRIGGER_BOTTOM_Y = BIG_FLOOR_TOP_Y + 0.05
const TRIGGER_TOP_Y = WALKABLE_TOP_Y - 0.8
export const HOLE_DEATH_TRIGGER_CENTER_Y = (TRIGGER_BOTTOM_Y + TRIGGER_TOP_Y) / 2
export const HOLE_DEATH_TRIGGER_HEIGHT = TRIGGER_TOP_Y - TRIGGER_BOTTOM_Y

declare const EVENT: {
  ANY_LIFEENTITY_TRIGGER_SPACE: string
}
declare const Enums: { TriggerSpaceEventType: { ENTER: number } }

function handleTriggerData(data: unknown, source: string): void {
  const eventData = data as { event_unit?: unknown; unit?: unknown } | undefined
  eliminateUnitAndRebirthAtBirth(eventData?.event_unit !== undefined ? eventData.event_unit : eventData?.unit, source)
}

export function registerHoleDeathTriggerUnit(trigger: unknown, name: string): boolean {
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] trigger register skipped name=${name} trigger=nil`)
    return false
  }
  const triggerId = safeCall(
    () => {
      return (trigger as any).get_id()
    },
    { tag: `hole_death_trigger_id_${name}`, fallback: null, logger: print }
  )
  if (triggerId === null || triggerId === undefined) {
    print(`[${TAG}] trigger register skipped name=${name} trigger_id=nil`)
    return false
  }
  TriggerHub.register(
    [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
    (_eventName: unknown, _actor: unknown, data: unknown) => handleTriggerData(data, `scene:${name}:${tostring(triggerId)}`),
    { safe: true, safeCallback: true, tag: `hole_death_scene_${name}`, logger: print }
  )
  return true
}
