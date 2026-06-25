import { safeCall } from "@common/engine_safe"
import { BIRTH_SPAWN_X, BIRTH_SPAWN_Y, BIRTH_SPAWN_Z, TAG } from "../config"
import { configureRoleBirthRebirthPoint, configureUnitBirthRebirth } from "./rebirth"
import { getOnlineRoles, roleKey } from "../runtime/runtime_roles"

const spawnAdjustedRoles = new Map<string, boolean>()

function adjustRoleSpawnToBirthTile(role: Role): void {
  const key = roleKey(role)
  configureRoleBirthRebirthPoint(role, `spawn_${key}`)
  if (spawnAdjustedRoles.get(key) === true) {
    return
  }
  const character = safeCall(
    () => {
      const getCtrlUnit = (role as any).get_ctrl_unit
      return getCtrlUnit()
    },
    { tag: `birth_spawn_get_ctrl_${key}`, fallback: null, logger: print }
  ) as Character | null
  if (character === null || character === undefined) {
    print(`[${TAG}] birth spawn skipped role=${key} character=nil`)
    return
  }
  configureUnitBirthRebirth(character, `spawn_${key}`)
  safeCall(
    () => {
      ;(character as any).set_position(math.Vector3(BIRTH_SPAWN_X as Fixed, BIRTH_SPAWN_Y as Fixed, BIRTH_SPAWN_Z as Fixed))
    },
    { tag: `birth_spawn_set_position_${key}`, fallback: undefined, logger: print }
  )
  spawnAdjustedRoles.set(key, true)
  print(`[${TAG}] birth spawn adjusted role=${key} pos=(${BIRTH_SPAWN_X},${BIRTH_SPAWN_Y},${BIRTH_SPAWN_Z})`)
}

export function adjustOnlineRolesSpawnToBirthTile(): void {
  const roles = getOnlineRoles()
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]
    if (role !== undefined) {
      adjustRoleSpawnToBirthTile(role)
    }
  }
}
