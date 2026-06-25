import { safeCall } from "@common/engine_safe"
import { RUNTIME_SCENE_BINDINGS } from "../levels/runtime_scene_bindings"
import type { RuntimeSceneBinding } from "../levels/shared/types"
import {
  FOURTH_LEVEL_COMPRESSOR_DOWN_Y,
  TERRAIN_TAG,
} from "../config"
import { registerRuntimeCompressorPiece, resetRuntimeCompressors, startRuntimeCompressors } from "./runtime_compressor"
import { createHoleDeathTriggers } from "./runtime_fall_return"
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
  runtimeModuleName,
} from "../layout"

let editorSceneMechanismsBound = false
const SECOND_CHASER_SURFACE_MODULE_INDEX = 2
const SECOND_CHASER_SURFACE_FRICTION = 1.2
const SECOND_CHASER_SURFACE_ROLLING_RESISTANCE = 0.02
const SECOND_CHASER_SURFACE_BOUNCINESS = 0

type Position3 = {
  x: number
  y: number
  z: number
}

type Scale3 = {
  x: number
  y: number
  z: number
}

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

function applySecondChaserSurfacePhysics(moduleIndex: number, unit: unknown, name: string): void {
  if (moduleIndex !== SECOND_CHASER_SURFACE_MODULE_INDEX) {
    return
  }
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

function editorSceneUnitName(pieceName: string, moduleIndex: number): string {
  return `QR_${editorModuleLabel(moduleIndex)}_${pieceName}`
}

function queryEditorUnit(name: string): unknown {
  const unit = safeCall(
    () => {
      return (LuaAPI as any).query_unit(name)
    },
    { tag: `editor_scene_query_${name}`, fallback: null, logger: print }
  )
  if (unit === null || unit === undefined) {
    print(`[${TERRAIN_TAG}] editor unit missing name=${name}`)
    return null
  }
  return unit
}

function getUnitPosition(unit: unknown, fallback: Position3, name: string): Position3 {
  const pos = safeCall(
    () => {
      return (unit as any).get_position()
    },
    { tag: `editor_scene_position_${name}`, fallback: null, logger: print }
  ) as { x?: number; y?: number; z?: number } | null
  if (pos === null || pos === undefined || pos.x === undefined || pos.y === undefined || pos.z === undefined) {
    return fallback
  }
  return {
    x: pos.x,
    y: pos.y,
    z: pos.z,
  }
}

function getUnitScale(unit: unknown, name: string): Scale3 | null {
  const scale = safeCall(
    () => {
      const target = unit as any
      if (target.get_scale !== undefined && target.get_scale !== null) {
        return target.get_scale()
      }
      return null
    },
    { tag: `editor_scene_scale_${name}`, fallback: null, logger: print }
  ) as { x?: number; y?: number; z?: number } | null
  if (scale === null || scale === undefined || scale.x === undefined || scale.y === undefined || scale.z === undefined) {
    print(`[${TERRAIN_TAG}] editor unit scale missing name=${name}`)
    return null
  }
  return {
    x: scale.x,
    y: scale.y,
    z: scale.z,
  }
}

function bindingRuntimeName(binding: RuntimeSceneBinding): string {
  return runtimeModuleName(binding.component, binding.module)
}

function bindingEditorName(binding: RuntimeSceneBinding): string {
  return editorSceneUnitName(binding.component, binding.module)
}

function registerEditorSceneBinding(binding: RuntimeSceneBinding, unit: unknown, position: Position3, scale: Scale3): void {
  const name = bindingRuntimeName(binding)
  if (binding.role === "second_chaser_surface") {
    applySecondChaserSurfacePhysics(binding.module, unit, name)
    return
  }
  if (binding.role === "fourth_compressor") {
    registerRuntimeCompressorPiece({
      name,
      unit,
      x: position.x,
      z: position.z,
      sx: scale.x,
      sy: scale.y,
      sz: scale.z,
      upY: position.y,
      downY: FOURTH_LEVEL_COMPRESSOR_DOWN_Y,
    })
    return
  }
  if (binding.role === "eighth_moving_part") {
    if (binding.moveZ === undefined) {
      print(`[${TERRAIN_TAG}] binding skipped name=${name} role=${binding.role} reason=missing_moveZ`)
      return
    }
    registerEighthLevelMechanismBinding(unit, name, position.x, position.y, position.z, scale.x, scale.y, scale.z, binding.moveZ)
    return
  }

  if (binding.role === "third_timed_platform") {
    registerThirdLevelTimedPlatformBinding(unit, name, binding.component, position.x, position.y, position.z, scale.x, scale.y, scale.z)
    return
  }
  if (binding.role === "ninth_vanishing_platform") {
    registerNinthVanishingPlatformBinding(unit, name, position.x, position.z, scale.x, scale.z)
    return
  }
  if (binding.role === "tenth_current") {
    registerTenthCurrentBinding(unit, name, position.x, position.y, position.z, scale.x, scale.y, scale.z, binding.moving === true)
  }
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

  print(`[${TERRAIN_TAG}] editor bind begin bindings=${RUNTIME_SCENE_BINDINGS.length} source=runtime_scene_bindings`)
  let bound = 0
  let missing = 0
  let scaleMissing = 0
  for (let i = 0; i < RUNTIME_SCENE_BINDINGS.length; i++) {
    const binding = RUNTIME_SCENE_BINDINGS[i]!
    const editorName = bindingEditorName(binding)
    const unit = queryEditorUnit(editorName)
    if (unit === null || unit === undefined) {
      missing += 1
      continue
    }
    const position = getUnitPosition(unit, { x: 0, y: 0, z: 0 }, editorName)
    const scale = getUnitScale(unit, editorName)
    if (scale === null) {
      scaleMissing += 1
      continue
    }
    registerEditorSceneBinding(binding, unit, position, scale)
    bound += 1
    print(
      `[${TERRAIN_TAG}] editor bound name=${editorName} runtime_name=${bindingRuntimeName(binding)} role=${binding.role} pos=(${position.x},${position.y},${position.z}) scale=(${scale.x},${scale.y},${scale.z})`
    )
  }
  print(`[${TERRAIN_TAG}] editor bind summary bindings=${RUNTIME_SCENE_BINDINGS.length} bound=${bound} missing=${missing} scale_missing=${scaleMissing}`)

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
  createHoleDeathTriggers()
  print(`[${TERRAIN_TAG}] editor bind complete`)
}
