import { safeCall } from "@common/engine_safe"
import {
  EIGHTH_LEVEL_MECHANISM_MOVE_Z,
  EIGHTH_LEVEL_MECHANISM_SPLIT_Z,
  EIGHTH_LEVEL_TERRAIN_MODULE_INDEX,
  FOURTH_LEVEL_COMPRESSOR_DOWN_SECONDS,
  FOURTH_LEVEL_COMPRESSOR_DOWN_Y,
  FOURTH_LEVEL_COMPRESSOR_START_Y,
  TERRAIN_TAG,
} from "../config"
import {
  registerRuntimeCompressorDeathTriggerUnit,
  registerRuntimeCompressorPiece,
  resetRuntimeCompressors,
  startRuntimeCompressors,
} from "./runtime_compressor"
import { registerHoleDeathTriggerUnit } from "./runtime_fall_return"
import {
  registerEighthLevelMechanismBinding,
  registerEighthLevelMechanismDeathTriggerUnit,
  resetEighthLevelMechanism,
  startEighthLevelMechanism,
} from "./runtime_eighth_mechanism"
import {
  registerNinthVanishingPlatformBinding,
  registerNinthVanishingDeathTriggerBinding,
  registerNinthVanishingTriggerBinding,
  registerVanishingPlatformBinding,
  registerVanishingPlatformTriggerBinding,
  resetNinthLevelMechanism,
} from "./runtime_ninth_mechanism"
import { startSecondLevelChaser } from "./runtime_second_chaser"
import {
  registerThirdLevelTimedPlatformBinding,
  resetThirdLevelMechanism,
  startThirdLevelMechanism,
} from "./runtime_third_mechanism"
import {
  registerTenthCurrentBinding,
  registerTenthCurrentTriggerBinding,
  resetTenthCurrentMechanism,
  startTenthCurrentMechanism,
} from "./runtime_tenth_current"
import { registerTenthVictoryTriggerUnit, resetTenthVictoryTrigger } from "./runtime_tenth_victory"
import { registerFirstVictoryCoinTriggerUnit, resetFirstVictoryCoinTrigger } from "./runtime_first_victory_coin"
import { createFifthMiddleLayer } from "./fifth_middle_layer"
import {
  asFixed,
  getRuntimeFloorForModule,
  getRuntimeModuleCenterX,
} from "../layout"
import { scanQuickRunnerRuntimeScene, type RuntimeSceneUnit } from "./runtime_scene_scan"

let editorSceneMechanismsBound = false
let eighthMoveZFallbackLogCount = 0
const SECOND_CHASER_SURFACE_FRICTION = 1.2
const SECOND_CHASER_SURFACE_ROLLING_RESISTANCE = 0.02
const SECOND_CHASER_SURFACE_BOUNCINESS = 0

function setRuntimeFixedAttr(unit: unknown, key: string, value: number, tag: string): boolean {
  if (unit === null || unit === undefined) {
    return false
  }
  const target = unit as any
  if (target.set_attr_by_type === undefined || target.set_attr_by_type === null) {
    return false
  }
  const applied = safeCall(
    () => {
      target.set_attr_by_type(Enums.ValueType.Fixed, key, asFixed(value))
      return true
    },
    { tag, fallback: false, logger: print }
  )
  return applied === true
}

function applySecondChaserSurfacePhysics(unit: unknown, name: string): void {
  setRuntimeFixedAttr(
    unit,
    "FrictionCoefficient",
    SECOND_CHASER_SURFACE_FRICTION,
    `second_chaser_surface_friction_${name}`
  )
  setRuntimeFixedAttr(
    unit,
    "RollingResistance",
    SECOND_CHASER_SURFACE_ROLLING_RESISTANCE,
    `second_chaser_surface_rolling_${name}`
  )
  setRuntimeFixedAttr(
    unit,
    "Bounciness",
    SECOND_CHASER_SURFACE_BOUNCINESS,
    `second_chaser_surface_bounce_${name}`
  )
}

function editorModuleLabel(moduleIndex: number): string {
  return moduleIndex === 0 ? "出生地" : `第${moduleIndex < 10 ? "0" : ""}${moduleIndex}关`
}

function registerRuntimeSceneUnit(item: RuntimeSceneUnit): boolean {
  const name = item.runtimeName
  if (item.role === "second_chaser_surface") {
    applySecondChaserSurfacePhysics(item.unit, name)
    return true
  }
  if (item.role === "first_victory_coin_trigger") {
    return registerFirstVictoryCoinTriggerUnit(
      item.unit,
      name,
      item.coinReward === undefined ? 5 : item.coinReward,
      item.respawnAtBirth !== false
    )
  }
  if (item.role === "fall_death") {
    return registerHoleDeathTriggerUnit(item.unit, name)
  }
  if (item.role === "fourth_compressor") {
    registerRuntimeCompressorPiece({
      name,
      unit: item.unit,
      x: item.x,
      z: item.z,
      sx: item.sx,
      sy: item.sy,
      sz: item.sz,
      upY: FOURTH_LEVEL_COMPRESSOR_START_Y,
      downY: FOURTH_LEVEL_COMPRESSOR_DOWN_Y,
      moveSeconds: item.moveSeconds === undefined ? FOURTH_LEVEL_COMPRESSOR_DOWN_SECONDS : item.moveSeconds,
    })
    return true
  }
  if (item.role === "fourth_compressor_death_trigger") {
    if (item.targetRuntimeName === undefined) {
      print(`[${TERRAIN_TAG}] scene unit skipped name=${name} role=${item.role} reason=missing_QRTargetRuntimeName`)
      return false
    }
    if (item.touchDeath === false) {
      print(`[${TERRAIN_TAG}] scene unit skipped name=${name} role=${item.role} reason=QRTouchDeath_false`)
      return false
    }
    return registerRuntimeCompressorDeathTriggerUnit(item.unit, name, item.targetRuntimeName)
  }
  if (item.role === "eighth_moving_part") {
    let moveZ = item.moveZ
    if (moveZ === undefined && item.module === EIGHTH_LEVEL_TERRAIN_MODULE_INDEX) {
      const floor = getRuntimeFloorForModule(item.module)
      const splitWorldZ = floor.z - floor.sz / 2 + EIGHTH_LEVEL_MECHANISM_SPLIT_Z
      moveZ = item.z < splitWorldZ ? -EIGHTH_LEVEL_MECHANISM_MOVE_Z : EIGHTH_LEVEL_MECHANISM_MOVE_Z
      if (eighthMoveZFallbackLogCount < 3) {
        print(`[${TERRAIN_TAG}] scene unit fallback moveZ name=${name} z=${item.z} splitZ=${splitWorldZ} moveZ=${moveZ}`)
        eighthMoveZFallbackLogCount += 1
      }
    }
    if (moveZ === undefined) {
      print(`[${TERRAIN_TAG}] scene unit skipped name=${name} role=${item.role} reason=missing_QRMoveZ`)
      return false
    }
    registerEighthLevelMechanismBinding(item.unit, name, item.x, item.y, item.z, item.sx, item.sy, item.sz, moveZ)
    return true
  }
  if (item.role === "eighth_moving_death_trigger") {
    if (item.targetRuntimeName === undefined) {
      print(`[${TERRAIN_TAG}] scene unit skipped name=${name} role=${item.role} reason=missing_QRTargetRuntimeName`)
      return false
    }
    if (item.touchDeath === false) {
      print(`[${TERRAIN_TAG}] scene unit skipped name=${name} role=${item.role} reason=QRTouchDeath_false`)
      return false
    }
    return registerEighthLevelMechanismDeathTriggerUnit(item.unit, name, item.targetRuntimeName)
  }

  if (item.role === "third_timed_platform") {
    registerThirdLevelTimedPlatformBinding(item.unit, name, item.component, item.x, item.y, item.z, item.sx, item.sy, item.sz)
    return true
  }
  if (item.role === "third_vanishing_platform") {
    registerVanishingPlatformBinding(item.unit, name)
    return true
  }
  if (item.role === "third_vanishing_trigger") {
    if (item.targetRuntimeName === undefined) {
      print(`[${TERRAIN_TAG}] scene unit skipped name=${name} role=${item.role} reason=missing_QRTargetRuntimeName`)
      return false
    }
    registerVanishingPlatformTriggerBinding(item.unit, name, item.targetRuntimeName)
    return true
  }
  if (item.role === "ninth_vanishing_platform") {
    registerNinthVanishingPlatformBinding(item.unit, name, item.x, item.z, item.sx, item.sz)
    return true
  }
  if (item.role === "ninth_vanishing_trigger") {
    if (item.targetRuntimeName === undefined) {
      print(`[${TERRAIN_TAG}] scene unit skipped name=${name} role=${item.role} reason=missing_QRTargetRuntimeName`)
      return false
    }
    return registerNinthVanishingTriggerBinding(item.unit, name, item.targetRuntimeName)
  }
  if (item.role === "ninth_vanishing_death_trigger") {
    if (item.targetRuntimeName === undefined) {
      print(`[${TERRAIN_TAG}] scene unit skipped name=${name} role=${item.role} reason=missing_QRTargetRuntimeName`)
      return false
    }
    return registerNinthVanishingDeathTriggerBinding(item.unit, name, item.targetRuntimeName)
  }
  if (item.role === "tenth_current") {
    registerTenthCurrentBinding(item.unit, name, item.x, item.y, item.z, item.sx, item.sy, item.sz, item.moving === true)
    return true
  }
  if (item.role === "tenth_current_trigger") {
    if (item.targetRuntimeName === undefined) {
      print(`[${TERRAIN_TAG}] scene unit skipped name=${name} role=${item.role} reason=missing_QRTargetRuntimeName`)
      return false
    }
    return registerTenthCurrentTriggerBinding(item.unit, name, item.targetRuntimeName, item.x, item.y, item.z, item.moving === true)
  }
  if (item.role === "tenth_current_group") {
    return true
  }
  if (item.role === "tenth_victory_trigger") {
    if (item.finishGame === false) {
      print(`[${TERRAIN_TAG}] scene unit skipped name=${name} role=${item.role} reason=QRFinishGame_false`)
      return false
    }
    return registerTenthVictoryTriggerUnit(item.unit, name)
  }
  print(`[${TERRAIN_TAG}] scene unit skipped name=${name} role=${item.role} reason=unknown_role`)
  return false
}

export function bindEditorSceneRuntimeMechanisms(): void {
  if (editorSceneMechanismsBound) {
    return
  }
  editorSceneMechanismsBound = true
  resetRuntimeCompressors()
  resetFirstVictoryCoinTrigger()
  resetEighthLevelMechanism()
  eighthMoveZFallbackLogCount = 0
  resetNinthLevelMechanism()
  resetThirdLevelMechanism()
  resetTenthCurrentMechanism()
  resetTenthVictoryTrigger()

  const sceneUnits = scanQuickRunnerRuntimeScene()
  for (let i = 0; i < sceneUnits.length; i++) {
    const item = sceneUnits[i]!
    if (!registerRuntimeSceneUnit(item)) {
      print(`[${TERRAIN_TAG}] editor skipped name=${item.runtimeName} role=${item.role}`)
    }
  }

  startRuntimeCompressors()
  startThirdLevelMechanism()
  createFifthMiddleLayer({
    floor: getRuntimeFloorForModule(5),
    moduleCenterX: getRuntimeModuleCenterX(5),
    moduleLabel: editorModuleLabel(5),
  })
  startEighthLevelMechanism()
  startTenthCurrentMechanism()
  startSecondLevelChaser()
}
