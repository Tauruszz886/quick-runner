import { createFastRunSystem, type FastRunSystem } from "@gameplay-kits/fast_run_system"
import { UINodes } from "../../generated/exported_data"
import { DASHBOARD_CENTER_X, DASHBOARD_CENTER_Y, DASHBOARD_OPACITY, DEFAULT_SPEED, SPEED_TAG } from "../config"
import { getOnlineRoles } from "./runtime_roles"

let fastRunSystem: FastRunSystem | undefined
let currentSpeedValue = DEFAULT_SPEED

function fastRunLogger(...args: unknown[]): void {
  const lastArg = args.length > 0 ? args[args.length - 1] : ""
  const text = tostring(lastArg)
  if (text.indexOf("[FastRunSystemVelocity]") >= 0) {
    return
  }
  print(text)
}

function ensureFastRunComponentForRole(role: Role): void {
  if (fastRunSystem === undefined) {
    return
  }
  if (fastRunSystem.getComponent(role) !== null) {
    const component = fastRunSystem.getComponent(role)
    if (component !== null) {
      component.setMaxSpeed(currentSpeedValue)
    }
    return
  }
  fastRunSystem.addComponent(role, {
    maxSpeed: currentSpeedValue,
  })
}

function ensureFastRunComponentsForOnlineRoles(): void {
  if (fastRunSystem === undefined) {
    return
  }
  const roles = getOnlineRoles()
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]
    if (role !== undefined) {
      ensureFastRunComponentForRole(role)
    }
  }
}

export function setQuickRunnerSpeed(speed: number): void {
  currentSpeedValue = speed as Fixed
  ensureFastRunComponentsForOnlineRoles()
}

export function startSystems(): void {
  if (fastRunSystem !== undefined && fastRunSystem.isEnabled()) {
    ensureFastRunComponentsForOnlineRoles()
    return
  }

  fastRunSystem = createFastRunSystem({
    maxSpeed: DEFAULT_SPEED,
    groundAcceleration: 1000,
    groundDeceleration: 1000,
    airAcceleration: 1000,
    airDeceleration: 1000,
    maxLinearVelocity: 1000,
    obstacle: {
      enabled: true,
      distance: 2,
      logIntervalTicks: 0 as integer,
    },
    testMode: {
      enabled: true,
      parentNode: UINodes["画布0"] as unknown as ENode,
      x: DASHBOARD_CENTER_X,
      y: DASHBOARD_CENTER_Y,
      maxSpeed: 1000,
    },
    logger: fastRunLogger,
  })
  fastRunSystem.setEnabled(true)
  ensureFastRunComponentsForOnlineRoles()
}

export function enableFastRunDashboard(): void {
  if (fastRunSystem === undefined) {
    print(`[${SPEED_TAG}] dashboard enable skipped system=nil`)
    return
  }
  const system = fastRunSystem as unknown as {
    testMode?: { enabled?: boolean }
    enableTestMode?: () => void
    updateDashboardLoop?: () => void
  }
  if (system.testMode !== undefined) {
    system.testMode.enabled = true
  }
  if (system.enableTestMode !== undefined) {
    system.enableTestMode()
  }
  if (system.updateDashboardLoop !== undefined) {
    system.updateDashboardLoop()
  }
}

export function hideLegacySpeedUiForOnlineRoles(): void {
}
