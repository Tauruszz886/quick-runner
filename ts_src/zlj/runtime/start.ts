import { TriggerHub } from "@common/trigger_hub"
import { adjustOnlineRolesSpawnToBirthTile } from "../birth/spawn"
import { hideLegacySpeedUiForOnlineRoles, startSystems } from "./runtime_speed"
import { bindEditorSceneRuntimeMechanisms } from "./runtime_terrain"
import { registerLevelSelectUi } from "./runtime_level_select"
import { registerFirstVictoryCoinUi } from "./runtime_first_victory_coin"
import { startMovementExperienceRuntime } from "../progression/movement_experience"
import { startExperienceBonusUiRuntime } from "../progression/experience_bonus_ui"
import { startRebirthRuntime } from "../progression/rebirth_runtime"

const EDITOR_SCENE_MECHANISM_BIND_DELAY_SECONDS = 1.5

function schedulePlayerRuntime(): void {
  startSystems()
  hideLegacySpeedUiForOnlineRoles()

  TriggerHub.register(
    [EVENT.TIMEOUT, 1],
    () => {
      startSystems()
      hideLegacySpeedUiForOnlineRoles()
      registerLevelSelectUi()
      registerFirstVictoryCoinUi()
      startExperienceBonusUiRuntime()
      startRebirthRuntime()
      startMovementExperienceRuntime()
      adjustOnlineRolesSpawnToBirthTile()
    },
    {
      safe: true,
      safeCallback: true,
      tag: "quick_runner_player_runtime_delay",
      logger: print,
    },
  )

  TriggerHub.register([EVENT.TIMEOUT, 0.2], () => adjustOnlineRolesSpawnToBirthTile(), {
    safe: true,
    safeCallback: true,
    tag: "quick_runner_birth_spawn_adjust_delay_0_2",
    logger: print,
  })
  TriggerHub.register([EVENT.TIMEOUT, 2], () => adjustOnlineRolesSpawnToBirthTile(), {
    safe: true,
    safeCallback: true,
    tag: "quick_runner_birth_spawn_adjust_delay_2",
    logger: print,
  })
  registerLevelSelectUi()
  registerFirstVictoryCoinUi()
  startExperienceBonusUiRuntime()
  startRebirthRuntime()
  startMovementExperienceRuntime()
}

function scheduleEditorSceneMechanisms(): void {
  TriggerHub.register([EVENT.TIMEOUT, EDITOR_SCENE_MECHANISM_BIND_DELAY_SECONDS], () => bindEditorSceneRuntimeMechanisms(), {
    safe: true,
    safeCallback: true,
    tag: "quick_runner_editor_scene_mechanism_bind_delay",
    logger: print,
  })
}

export function startQuickRunnerRuntime(): void {
  LuaAPI.global_register_trigger_event([EVENT.GAME_INIT], () => {
    schedulePlayerRuntime()
    scheduleEditorSceneMechanisms()
  })
}
