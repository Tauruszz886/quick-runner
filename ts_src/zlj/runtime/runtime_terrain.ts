import { safeCall } from "@common/engine_safe"
import {
  FOURTH_LEVEL_COMPRESSOR_DOWN_Y,
  TERRAIN_TAG,
} from "../config"
import { registerRuntimeCompressorPiece, resetRuntimeCompressors, startRuntimeCompressors } from "./runtime_compressor"
import { registerHoleDeathTriggerUnit } from "./runtime_fall_return"
import {
  registerEighthLevelMechanismBinding,
  resetEighthLevelMechanism,
  startEighthLevelMechanism,
} from "./runtime_eighth_mechanism"
import { registerNinthVanishingPlatformBinding, resetNinthLevelMechanism } from "./runtime_ninth_mechanism"
import { startSecondLevelChaser } from "./runtime_second_chaser"
import {
  registerThirdLevelTimedPlatformBinding,
  resetThirdLevelMechanism,
  startThirdLevelMechanism,
} from "./runtime_third_mechanism"
import { registerTenthCurrentBinding, resetTenthCurrentMechanism, startTenthCurrentMechanism } from "./runtime_tenth_current"
import { createFifthMiddleLayer } from "./fifth_middle_layer"
import {
  asFixed,
  getRuntimeFloorForModule,
  getRuntimeModuleCenterX,
} from "../layout"
import { scanQuickRunnerRuntimeScene, type RuntimeSceneUnit } from "./runtime_scene_scan"

let editorSceneMechanismsBound = false
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
  const frictionApplied = setRuntimeFixedAttr(
    unit,
    "FrictionCoefficient",
    SECOND_CHASER_SURFACE_FRICTION,
    `second_chaser_surface_friction_${name}`
  )
  const rollingApplied = setRuntimeFixedAttr(
    unit,
    "RollingResistance",
    SECOND_CHASER_SURFACE_ROLLING_RESISTANCE,
    `second_chaser_surface_rolling_${name}`
  )
  const bounceApplied = setRuntimeFixedAttr(
    unit,
    "Bounciness",
    SECOND_CHASER_SURFACE_BOUNCINESS,
    `second_chaser_surface_bounce_${name}`
  )
  print(
    `[${TERRAIN_TAG}] second_chaser_surface_physics name=${name} friction=${SECOND_CHASER_SURFACE_FRICTION} rolling=${SECOND_CHASER_SURFACE_ROLLING_RESISTANCE} bounce=${SECOND_CHASER_SURFACE_BOUNCINESS} runtime_attr=${frictionApplied && rollingApplied && bounceApplied}`
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
      upY: item.y,
      downY: FOURTH_LEVEL_COMPRESSOR_DOWN_Y,
    })
    return true
  }
  if (item.role === "eighth_moving_part") {
    if (item.moveZ === undefined) {
      print(`[${TERRAIN_TAG}] scene unit skipped name=${name} role=${item.role} reason=missing_QRMoveZ`)
      return false
    }
    registerEighthLevelMechanismBinding(item.unit, name, item.x, item.y, item.z, item.sx, item.sy, item.sz, item.moveZ)
    return true
  }

  if (item.role === "third_timed_platform") {
    registerThirdLevelTimedPlatformBinding(item.unit, name, item.component, item.x, item.y, item.z, item.sx, item.sy, item.sz)
    return true
  }
  if (item.role === "ninth_vanishing_platform") {
    registerNinthVanishingPlatformBinding(item.unit, name, item.x, item.z, item.sx, item.sz)
    return true
  }
  if (item.role === "tenth_current") {
    registerTenthCurrentBinding(item.unit, name, item.x, item.y, item.z, item.sx, item.sy, item.sz, item.moving === true)
    return true
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
  resetEighthLevelMechanism()
  resetNinthLevelMechanism()
  resetThirdLevelMechanism()
  resetTenthCurrentMechanism()

  const sceneUnits = scanQuickRunnerRuntimeScene()
  print(`[${TERRAIN_TAG}] editor bind begin scene_units=${sceneUnits.length} source=scene_custom_kv`)
  let bound = 0
  for (let i = 0; i < sceneUnits.length; i++) {
    const item = sceneUnits[i]!
    if (registerRuntimeSceneUnit(item)) {
      bound += 1
      print(
        `[${TERRAIN_TAG}] editor bound name=${item.runtimeName} role=${item.role} pos=(${item.x},${item.y},${item.z}) scale=(${item.sx},${item.sy},${item.sz})`
      )
    } else {
      print(`[${TERRAIN_TAG}] editor skipped name=${item.runtimeName} role=${item.role}`)
    }
  }
  print(`[${TERRAIN_TAG}] editor bind summary scene_units=${sceneUnits.length} bound=${bound}`)

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
  print(`[${TERRAIN_TAG}] editor bind complete`)
}
