import { safeCall, safeCreateCustomTriggerSpace, safeCreateObstacle } from "@common/engine_safe"
import { LEVEL_TERRAIN_SPECS, type LevelTerrainSpec } from "../levels/terrain"
import { RUNTIME_SCENE_BINDINGS } from "../levels/runtime_scene_bindings"
import type { RuntimeSceneBinding } from "../levels/shared/types"
import {
  BIRTH_TILE_BASE_Y,
  EIGHTH_LEVEL_MECHANISM_MOVE_SECONDS,
  EIGHTH_LEVEL_MECHANISM_MOVE_Z,
  EIGHTH_LEVEL_TERRAIN_CREATE_BATCH_SIZE,
  EIGHTH_LEVEL_TERRAIN_MODULE_INDEX,
  FIRST_LEVEL_TERRAIN_BASE_Y,
  FIRST_LEVEL_TERRAIN_HEIGHT,
  FOURTH_LEVEL_COMPRESSOR_DOWN_Y,
  FOURTH_LEVEL_COMPRESSOR_START_Y,
  RUNTIME_COPY_COUNT,
  RUNTIME_FLOOR,
  TERRAIN_TAG,
  TILE_BASE_Y,
  TILE_HEIGHT,
  TILE_TAG,
  WALL_PREFAB_ID,
  type RuntimeFloor,
  type RuntimeTerrainPiece,
} from "../config"
import { registerRuntimeCompressorPiece, resetRuntimeCompressors, startRuntimeCompressors } from "./runtime_compressor"
import { createHoleDeathTriggers } from "./runtime_fall_return"
import {
  getRuntimeTerrainPieceY,
  registerEighthLevelMechanismBinding,
  registerEighthLevelMechanismPart,
  resetEighthLevelMechanism,
  isEighthLevelMechanismPiece,
  startEighthLevelMechanism,
} from "./runtime_eighth_mechanism"
import { isNinthVanishingPlatformPiece, registerNinthVanishingPlatform, registerNinthVanishingPlatformBinding, resetNinthLevelMechanism } from "./runtime_ninth_mechanism"
import { startSecondLevelChaser } from "./runtime_second_chaser"
import {
  isThirdLevelTimedPlatformPiece,
  registerThirdLevelTimedPlatform,
  resetThirdLevelMechanism,
  startThirdLevelMechanism,
} from "./runtime_third_mechanism"
import { isTenthCurrentPiece, registerTenthCurrentBinding, registerTenthCurrentPart, resetTenthCurrentMechanism, startTenthCurrentMechanism } from "./runtime_tenth_current"
import { createFifthMiddleLayer } from "./fifth_middle_layer"
import {
  asFixed,
  getRuntimeFloorForModule,
  getRuntimeModuleCenterX,
  getRuntimeTerrainFrameForModule,
  runtimeModuleLabel,
  runtimeModuleName,
} from "../layout"
import { drawRuntimeTileGrid } from "./runtime_structure"

let runtimeTilesCreated = false
let editorSceneMechanismsBound = false
const TRAILING_CURRENT_PREFAB_ID = 3301506
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

function getFullTileBaseY(moduleIndex: number): number {
  return moduleIndex === 0 ? BIRTH_TILE_BASE_Y : TILE_BASE_Y
}

function disableMirrorReflect(unit: unknown, tag: string): void {
  if (unit === null || unit === undefined) {
    return
  }
  safeCall(
    () => {
      ;(unit as any).set_mirror_reflect_enabled(false)
    },
    { tag, fallback: undefined, logger: print }
  )
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

function toRuntimeTerrainPiece(spec: LevelTerrainSpec): RuntimeTerrainPiece {
  if (spec.role === "fourth_compressor") {
    return {
      name: spec.name,
      startX: spec.startX,
      startZ: spec.startZ,
      sx: spec.sx,
      sy: spec.sy,
      sz: spec.sz,
      baseY: FOURTH_LEVEL_COMPRESSOR_START_Y,
      prefabId: spec.prefabId,
      compressorDownY: FOURTH_LEVEL_COMPRESSOR_DOWN_Y,
      compressor: true,
    }
  }
  return {
    name: spec.name,
    startX: spec.startX,
    startZ: spec.startZ,
    sx: spec.sx,
    sy: spec.sy,
    sz: spec.sz,
    baseY: spec.baseY,
    prefabId: spec.prefabId,
  }
}

function getRuntimeTerrainPiecesForModule(moduleIndex: number): RuntimeTerrainPiece[] {
  const specs = LEVEL_TERRAIN_SPECS[moduleIndex]
  if (specs === undefined) {
    return []
  }
  const pieces: RuntimeTerrainPiece[] = []
  for (let i = 0; i < specs.length; i++) {
    pieces.push(toRuntimeTerrainPiece(specs[i]!))
  }
  return pieces
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

function shouldCreateRuntimeMechanismFallback(moduleIndex: number, piece: RuntimeTerrainPiece): boolean {
  return (
    piece.compressor === true
    || isThirdLevelTimedPlatformPiece(moduleIndex, piece)
    || isEighthLevelMechanismPiece(moduleIndex, piece)
    || isNinthVanishingPlatformPiece(moduleIndex, piece)
    || isTenthCurrentPiece(moduleIndex, piece)
  )
}

function createRuntimeMechanismFallbackUnit(
  moduleIndex: number,
  piece: RuntimeTerrainPiece,
  name: string,
  x: number,
  y: number,
  z: number
): unknown {
  const prefabId = piece.prefabId === undefined ? WALL_PREFAB_ID : piece.prefabId
  const unit = createTerrainUnit(prefabId, x, y, z, piece.sx, piece.sy, piece.sz, name)
  disableMirrorReflect(unit, `runtime_mechanism_fallback_disable_mirror_${name}`)
  print(
    `[${TERRAIN_TAG}] mechanism fallback created module=${runtimeModuleLabel(moduleIndex)} name=${name} prefab=${prefabId} pos=(${x},${y},${z}) scale=(${piece.sx},${piece.sy},${piece.sz})`
  )
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

function registerEditorTerrainMechanism(moduleIndex: number, piece: RuntimeTerrainPiece, unit: unknown, x: number, y: number, z: number): void {
  const name = runtimeModuleName(piece.name, moduleIndex)
  if (piece.compressor === true && unit !== null && unit !== undefined) {
    registerRuntimeCompressorPiece({
      name,
      unit,
      x,
      z,
      sx: piece.sx,
      sy: piece.sy,
      sz: piece.sz,
      upY: y,
      downY: piece.compressorDownY === undefined ? FOURTH_LEVEL_COMPRESSOR_DOWN_Y : piece.compressorDownY,
    })
  }
  registerNinthVanishingPlatform(moduleIndex, piece, unit, name, x, z)
  registerThirdLevelTimedPlatform(moduleIndex, piece, unit, name, x, y, z)
  registerTenthCurrentPart(moduleIndex, piece, unit, name, x, y, z)
  registerEighthLevelMechanismPart(moduleIndex, piece, unit, name, x, y, z)
}

function bindingRuntimeName(binding: RuntimeSceneBinding): string {
  return runtimeModuleName(binding.component, binding.module)
}

function bindingEditorName(binding: RuntimeSceneBinding): string {
  return editorSceneUnitName(binding.component, binding.module)
}

function runtimePieceFromBinding(binding: RuntimeSceneBinding, scale: Scale3): RuntimeTerrainPiece {
  return {
    name: binding.component,
    startX: 0,
    startZ: 0,
    sx: scale.x,
    sy: scale.y,
    sz: scale.z,
    prefabId: binding.role === "tenth_current" ? TRAILING_CURRENT_PREFAB_ID : undefined,
  }
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

  const piece = runtimePieceFromBinding(binding, scale)
  if (binding.role === "third_timed_platform") {
    registerThirdLevelTimedPlatform(binding.module, piece, unit, name, position.x, position.y, position.z)
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

function createTerrainUnit(prefabId: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, name: string): unknown {
  const pos = math.Vector3(x as Fixed, y as Fixed, z as Fixed)
  const scale = math.Vector3(sx as Fixed, sy as Fixed, sz as Fixed)
  if (prefabId === TRAILING_CURRENT_PREFAB_ID) {
    return safeCreateCustomTriggerSpace(prefabId, pos, scale, {
      tag: `runtime_terrain_trigger_create_${name}`,
      logger: print,
    })
  }
  return safeCreateObstacle(prefabId, pos, scale, {
    tag: `runtime_terrain_create_${name}`,
    logger: print,
  })
}

function createRuntimeTerrain(
  floor: RuntimeFloor,
  moduleCenterX: number,
  moduleIndex: number,
  pieces: RuntimeTerrainPiece[],
  pattern: string,
  gapSummary: string
): void {
  const moduleMinX = moduleCenterX - floor.sx / 2
  const moduleMinZ = floor.z - floor.sz / 2
  print(
    `[${TERRAIN_TAG}] create begin module=${runtimeModuleLabel(moduleIndex)} prefab=${WALL_PREFAB_ID} module_center=(${moduleCenterX},${FIRST_LEVEL_TERRAIN_BASE_Y},${floor.z}) module_size=(${floor.sx},${floor.sz}) pieces=${pieces.length} pattern=${pattern} base_y=${FIRST_LEVEL_TERRAIN_BASE_Y} scale_y=${FIRST_LEVEL_TERRAIN_HEIGHT}`
  )
  let trailingCurrentCount = 0
  let trailingCurrentMinX = 999999
  let trailingCurrentMaxX = -999999
  let trailingCurrentMinZ = 999999
  let trailingCurrentMaxZ = -999999
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!
    const y = getRuntimeTerrainPieceY(moduleIndex, piece, FIRST_LEVEL_TERRAIN_BASE_Y)
    const x = moduleMinX + piece.startX + piece.sx / 2
    const z = moduleMinZ + piece.startZ + piece.sz / 2
    const name = runtimeModuleName(piece.name, moduleIndex)
    const prefabId = piece.prefabId === undefined ? WALL_PREFAB_ID : piece.prefabId
    if (prefabId === TRAILING_CURRENT_PREFAB_ID) {
      trailingCurrentCount += 1
      trailingCurrentMinX = math.min(trailingCurrentMinX, moduleMinX + piece.startX)
      trailingCurrentMaxX = math.max(trailingCurrentMaxX, moduleMinX + piece.startX + piece.sx)
      trailingCurrentMinZ = math.min(trailingCurrentMinZ, moduleMinZ + piece.startZ)
      trailingCurrentMaxZ = math.max(trailingCurrentMaxZ, moduleMinZ + piece.startZ + piece.sz)
    }
    const unit = createTerrainUnit(
      prefabId,
      x,
      y,
      z,
      piece.sx,
      piece.sy,
      piece.sz,
      name
    )
    disableMirrorReflect(unit, `runtime_terrain_disable_mirror_${name}`)
    applySecondChaserSurfacePhysics(moduleIndex, unit, name)
    if (piece.compressor === true && unit !== null) {
      registerRuntimeCompressorPiece({
        name,
        unit,
        x,
        z,
        sx: piece.sx,
        sy: piece.sy,
        sz: piece.sz,
        upY: y,
        downY: piece.compressorDownY === undefined ? FOURTH_LEVEL_COMPRESSOR_DOWN_Y : piece.compressorDownY,
      })
    }
    registerNinthVanishingPlatform(moduleIndex, piece, unit, name, x, z)
    registerThirdLevelTimedPlatform(moduleIndex, piece, unit, name, x, y, z)
    registerTenthCurrentPart(moduleIndex, piece, unit, name, x, y, z)
    print(
      `[${TERRAIN_TAG}] created name=${name} unit=${tostring(unit)} prefab=${prefabId} kind=${prefabId === TRAILING_CURRENT_PREFAB_ID ? "custom_trigger" : "obstacle"} base=(${x},${y},${z}) scale=(${piece.sx},${piece.sy},${piece.sz}) x_range=${moduleMinX + piece.startX}..${moduleMinX + piece.startX + piece.sx} z_range=${moduleMinZ + piece.startZ}..${moduleMinZ + piece.startZ + piece.sz} mirror=false compressor=${piece.compressor === true}`
    )
  }
  if (trailingCurrentCount > 0) {
    print(
      `[${TERRAIN_TAG}] trailing_current_summary module=${runtimeModuleLabel(moduleIndex)} prefab=${TRAILING_CURRENT_PREFAB_ID} count=${trailingCurrentCount} x_range=${trailingCurrentMinX}..${trailingCurrentMaxX} z_range=${trailingCurrentMinZ}..${trailingCurrentMaxZ}`
    )
  }
  print(`[${TERRAIN_TAG}] gaps module=${runtimeModuleLabel(moduleIndex)} ${gapSummary}`)
}

function createRuntimeTerrainBatched(
  floor: RuntimeFloor,
  moduleCenterX: number,
  moduleIndex: number,
  pieces: RuntimeTerrainPiece[],
  pattern: string,
  gapSummary: string,
  batchSize: number
): void {
  const moduleMinX = moduleCenterX - floor.sx / 2
  const moduleMinZ = floor.z - floor.sz / 2
  print(
    `[${TERRAIN_TAG}] create begin module=${runtimeModuleLabel(moduleIndex)} prefab=${WALL_PREFAB_ID} module_center=(${moduleCenterX},${FIRST_LEVEL_TERRAIN_BASE_Y},${floor.z}) module_size=(${floor.sx},${floor.sz}) pieces=${pieces.length} pattern=${pattern} base_y=${FIRST_LEVEL_TERRAIN_BASE_Y} scale_y=mixed batch_size=${batchSize}`
  )

  let index = 0
  const createBatch = (): void => {
    let createdThisFrame = 0
    while (index < pieces.length && createdThisFrame < batchSize) {
      const piece = pieces[index]!
      const y = getRuntimeTerrainPieceY(moduleIndex, piece, FIRST_LEVEL_TERRAIN_BASE_Y)
      const x = moduleMinX + piece.startX + piece.sx / 2
      const z = moduleMinZ + piece.startZ + piece.sz / 2
      const name = runtimeModuleName(piece.name, moduleIndex)
      const prefabId = piece.prefabId === undefined ? WALL_PREFAB_ID : piece.prefabId
      const unit = safeCreateObstacle(
        prefabId,
        math.Vector3(x as Fixed, y as Fixed, z as Fixed),
        math.Vector3(piece.sx as Fixed, piece.sy as Fixed, piece.sz as Fixed),
        { tag: `runtime_terrain_create_${name}`, logger: print }
      )
      disableMirrorReflect(unit, `runtime_terrain_disable_mirror_${name}`)
      registerEighthLevelMechanismPart(moduleIndex, piece, unit, name, x, y, z)
      print(
        `[${TERRAIN_TAG}] created name=${name} unit=${tostring(unit)} prefab=${prefabId} base=(${x},${y},${z}) scale=(${piece.sx},${piece.sy},${piece.sz}) x_range=${moduleMinX + piece.startX}..${moduleMinX + piece.startX + piece.sx} z_range=${moduleMinZ + piece.startZ}..${moduleMinZ + piece.startZ + piece.sz} mirror=false compressor=false batch=${math.floor(index / batchSize) + 1}`
      )
      index += 1
      createdThisFrame += 1
    }

    if (index < pieces.length) {
      ;(LuaAPI as any).call_delay_frame(1, createBatch)
      return
    }

    print(`[${TERRAIN_TAG}] gaps module=${runtimeModuleLabel(moduleIndex)} ${gapSummary}`)
    startEighthLevelMechanism()
  }

  createBatch()
}

export function createRuntimeTiles(): void {
  if (runtimeTilesCreated) {
    return
  }
  runtimeTilesCreated = true
  resetRuntimeCompressors()
  resetEighthLevelMechanism()
  resetNinthLevelMechanism()
  resetThirdLevelMechanism()
  resetTenthCurrentMechanism()

  print(
    `[${TILE_TAG}] create begin modules=${RUNTIME_COPY_COUNT + 1} full_or_dxf_tiles=${RUNTIME_COPY_COUNT + 1} dxf_levels=1..10 module_0=出生地 last_module=第${RUNTIME_COPY_COUNT}关 prefab=${WALL_PREFAB_ID} base_y=${TILE_BASE_Y} birth_base_y=${BIRTH_TILE_BASE_Y} terrain_source=split_level_files birth_tile=runtime`
  )
  for (let moduleIndex = 0; moduleIndex <= RUNTIME_COPY_COUNT; moduleIndex++) {
    const moduleFloor = getRuntimeFloorForModule(moduleIndex)
    const terrainFloor = getRuntimeTerrainFrameForModule(moduleIndex, moduleFloor)
    const x = getRuntimeModuleCenterX(moduleIndex)
    const dxfTerrainPieces = getRuntimeTerrainPiecesForModule(moduleIndex)
    if (dxfTerrainPieces.length > 0) {
      const pattern = `dxf_solid_only_level_${moduleIndex}`
      const gapSummary = `dxf_confirmed frame=${terrainFloor.sx}x${terrainFloor.sz} pieces=${dxfTerrainPieces.length} source=LEVEL_TERRAIN_SPECS`
      if (moduleIndex === EIGHTH_LEVEL_TERRAIN_MODULE_INDEX) {
        createRuntimeTerrainBatched(
          terrainFloor,
          x,
          moduleIndex,
          dxfTerrainPieces,
          pattern,
          `${gapSummary} mechanism=raised_crossbars_and_long_plates move_z=${EIGHTH_LEVEL_MECHANISM_MOVE_Z} move_seconds=${EIGHTH_LEVEL_MECHANISM_MOVE_SECONDS}`,
          EIGHTH_LEVEL_TERRAIN_CREATE_BATCH_SIZE
        )
      } else {
        createRuntimeTerrain(terrainFloor, x, moduleIndex, dxfTerrainPieces, pattern, gapSummary)
      }
      continue
    }
    const name = runtimeModuleName("地砖", moduleIndex)
    const tileY = getFullTileBaseY(moduleIndex)
    const unit = safeCreateObstacle(
      WALL_PREFAB_ID,
      math.Vector3(x as Fixed, tileY as Fixed, RUNTIME_FLOOR.z as Fixed),
      math.Vector3(moduleFloor.sx as Fixed, TILE_HEIGHT as Fixed, moduleFloor.sz as Fixed),
      { tag: `runtime_tile_create_${name}`, logger: print }
    )
    disableMirrorReflect(unit, `runtime_tile_disable_mirror_${name}`)
    print(
      `[${TILE_TAG}] created name=${name} unit=${tostring(unit)} base=(${x},${tileY},${RUNTIME_FLOOR.z}) scale=(${moduleFloor.sx},${TILE_HEIGHT},${moduleFloor.sz}) terrain_original=true mirror=false`
    )
  }

  drawRuntimeTileGrid()
  startRuntimeCompressors()
  startThirdLevelMechanism()
  startTenthCurrentMechanism()
  startSecondLevelChaser()
  createHoleDeathTriggers()
}
