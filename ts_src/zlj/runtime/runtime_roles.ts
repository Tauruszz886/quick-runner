import { safeCall } from "@common/engine_safe"

export function getOnlineRoles(): Role[] {
  const roles = safeCall(
    () => {
      return GameAPI.get_all_valid_roles()
    },
    { tag: "runtime_get_roles", fallback: [] as Role[], logger: print }
  )
  return roles !== undefined ? roles : []
}

export function roleKey(role: Role | undefined): string {
  return role !== undefined ? tostring(role) : "global"
}
