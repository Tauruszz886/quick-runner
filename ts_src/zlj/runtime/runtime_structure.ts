import { safeCall, safeCreateObstacle } from "@common/engine_safe"
import {
  CEILING_BASE_Y,
  FLOOR_BASE_Y,
  GRID_CELL_SIZE,
  GRID_LINE_BATCH_SIZE,
  GRID_LINE_COLOR,
  GRID_LINE_DURATION,
  GRID_LINE_Y,
  GRID_LINES_VISIBLE,
  GRID_TAG,
  LEVEL_FLOOR_PAINT_AREA_COLORS,
  LEVEL_FLOOR_PREFAB_ID,
  RUNTIME_CEILING,
  RUNTIME_COPY_COUNT,
  RUNTIME_FLOOR,
  RUNTIME_FLOOR_CREATE_BATCH_SIZE,
  SIDE_WALL_INSET,
  SIDE_WALL_THICKNESS,
  TENTH_LEVEL_TERRAIN_MODULE_INDEX,
  WALL_BASE_Y,
  WALL_HEIGHT,
  WALL_PREFAB_ID,
  WEST_WALL_OPENING_GAP_SZ,
  type RuntimeWall,
} from "../config"
import { asFixed, getRuntimeFloorForModule, getRuntimeModuleCenterX, runtimeModuleName } from "../layout"

let runtimeFloorsCreated = false
let runtimeWallsCreated = false
let runtimeCeilingCreated = false
let runtimeGridDrawStarted = false

function applyLevelFloorAppearance(unit: unknown, name: string): void {
  if (unit === null || unit === undefined) {
    return
  }
  for (let i = 0; i < LEVEL_FLOOR_PAINT_AREA_COLORS.length; i++) {
    const area = (i + 1) as PaintArea
    const color = LEVEL_FLOOR_PAINT_AREA_COLORS[i]!
    safeCall(
      () => {
        ;(unit as any).set_paint_area_color(area, color)
      },
      { tag: `runtime_level_floor_paint_${name}_${i + 1}`, fallback: undefined, logger: print }
    )
  }
  safeCall(
    () => {
      ;(unit as any).set_mirror_reflect_enabled(false)
    },
    { tag: `runtime_level_floor_disable_mirror_${name}`, fallback: undefined, logger: print }
  )
}

export function createRuntimeFloorCopies(): void {
  if (runtimeFloorsCreated) {
    return
  }
  runtimeFloorsCreated = true

  let moduleIndex = 0
  const createBatch = (): void => {
    let createdThisFrame = 0
    while (moduleIndex <= RUNTIME_COPY_COUNT && createdThisFrame < RUNTIME_FLOOR_CREATE_BATCH_SIZE) {
      const moduleFloor = getRuntimeFloorForModule(moduleIndex)
      const x = getRuntimeModuleCenterX(moduleIndex)
      const name = runtimeModuleName(RUNTIME_FLOOR.name, moduleIndex)
      const unit = safeCreateObstacle(
        LEVEL_FLOOR_PREFAB_ID,
        math.Vector3(x as Fixed, FLOOR_BASE_Y as Fixed, RUNTIME_FLOOR.z as Fixed),
        math.Vector3(moduleFloor.sx as Fixed, moduleFloor.sy as Fixed, moduleFloor.sz as Fixed),
        { tag: `runtime_floor_create_${name}`, logger: print }
      )
      applyLevelFloorAppearance(unit, name)
      moduleIndex += 1
      createdThisFrame += 1
    }
    if (moduleIndex <= RUNTIME_COPY_COUNT) {
      ;(LuaAPI as any).call_delay_frame(1, createBatch)
      return
    }
  }
  createBatch()
}

function addSideSegment(walls: RuntimeWall[], name: string, side: "east" | "west", x: number, startZ: number, endZ: number): void {
  const sz = endZ - startZ
  if (sz <= 0) {
    return
  }
  walls.push({
    name,
    side,
    x,
    z: startZ + sz / 2,
    sx: SIDE_WALL_THICKNESS,
    sz,
  })
}

function getRuntimeWallsForModule(moduleIndex: number): RuntimeWall[] {
  const floor = getRuntimeFloorForModule(moduleIndex)
  const centerX = getRuntimeModuleCenterX(moduleIndex)
  const centerZ = floor.z
  const minX = centerX - floor.sx / 2
  const maxX = centerX + floor.sx / 2
  const minZ = centerZ - floor.sz / 2
  const maxZ = centerZ + floor.sz / 2
  const wallMinZ = minZ + SIDE_WALL_INSET
  const wallMaxZ = maxZ - SIDE_WALL_INSET
  const walls: RuntimeWall[] = [
    {
      name: "北墙",
      side: "north",
      x: centerX,
      z: wallMinZ,
      sx: floor.sx - SIDE_WALL_INSET * 2,
      sz: SIDE_WALL_THICKNESS,
    },
    {
      name: "南墙",
      side: "south",
      x: centerX,
      z: wallMaxZ,
      sx: floor.sx - SIDE_WALL_INSET * 2,
      sz: SIDE_WALL_THICKNESS,
    },
  ]

  const addSideWithOpening = (prefix: string, side: "east" | "west", x: number, startZ: number, endZ: number): void => {
    const openingMinZ = centerZ - WEST_WALL_OPENING_GAP_SZ / 2
    const openingMaxZ = centerZ + WEST_WALL_OPENING_GAP_SZ / 2
    addSideSegment(walls, `${prefix}上段`, side, x, startZ, math.min(openingMinZ, endZ))
    addSideSegment(walls, `${prefix}下段`, side, x, math.max(openingMaxZ, startZ), endZ)
  }

  if (moduleIndex === 0) {
    addSideSegment(walls, "东墙", "east", maxX - SIDE_WALL_INSET, wallMinZ, wallMaxZ)
  } else {
    const previousFloor = getRuntimeFloorForModule(moduleIndex - 1)
    const previousCenterZ = previousFloor.z
    const previousMinZ = previousCenterZ - previousFloor.sz / 2 + SIDE_WALL_INSET
    const previousMaxZ = previousCenterZ + previousFloor.sz / 2 - SIDE_WALL_INSET
    addSideSegment(walls, "东墙外露上段", "east", maxX - SIDE_WALL_INSET, wallMinZ, math.min(previousMinZ, wallMaxZ))
    addSideSegment(walls, "东墙外露下段", "east", maxX - SIDE_WALL_INSET, math.max(previousMaxZ, wallMinZ), wallMaxZ)
  }

  if (moduleIndex === RUNTIME_COPY_COUNT || moduleIndex === TENTH_LEVEL_TERRAIN_MODULE_INDEX) {
    addSideSegment(walls, "西墙封口", "west", minX + SIDE_WALL_INSET, wallMinZ, wallMaxZ)
  } else {
    addSideWithOpening("西墙", "west", minX + SIDE_WALL_INSET, wallMinZ, wallMaxZ)
  }

  return walls
}

function createRuntimeWallUnit(wall: RuntimeWall, moduleIndex: number): void {
  const name = runtimeModuleName(wall.name, moduleIndex)
  const unit = safeCreateObstacle(
    WALL_PREFAB_ID,
    math.Vector3(wall.x as Fixed, WALL_BASE_Y as Fixed, wall.z as Fixed),
    math.Vector3(wall.sx as Fixed, WALL_HEIGHT as Fixed, wall.sz as Fixed),
    { tag: `runtime_wall_create_${name}`, logger: print }
  )
}

export function createRuntimeWalls(): void {
  if (runtimeWallsCreated) {
    return
  }
  runtimeWallsCreated = true

  for (let moduleIndex = 0; moduleIndex <= RUNTIME_COPY_COUNT; moduleIndex++) {
    const walls = getRuntimeWallsForModule(moduleIndex)
    for (let i = 0; i < walls.length; i++) {
      createRuntimeWallUnit(walls[i]!, moduleIndex)
    }
  }
}

export function createRuntimeCeiling(): void {
  if (runtimeCeilingCreated) {
    return
  }
  runtimeCeilingCreated = true

  for (let moduleIndex = 0; moduleIndex <= RUNTIME_COPY_COUNT; moduleIndex++) {
    const moduleFloor = getRuntimeFloorForModule(moduleIndex)
    const x = getRuntimeModuleCenterX(moduleIndex)
    const name = runtimeModuleName(RUNTIME_CEILING.name, moduleIndex)
    const unit = safeCreateObstacle(
      WALL_PREFAB_ID,
      math.Vector3(x as Fixed, CEILING_BASE_Y as Fixed, RUNTIME_CEILING.z as Fixed),
      math.Vector3(moduleFloor.sx as Fixed, RUNTIME_CEILING.sy as Fixed, moduleFloor.sz as Fixed),
      { tag: `runtime_ceiling_create_${name}`, logger: print }
    )
  }
}

function drawRuntimeGridLine(startX: number, startZ: number, endX: number, endZ: number, color: unknown): void {
  ;(GameAPI as any).draw_line(
    math.Vector3(asFixed(startX), asFixed(GRID_LINE_Y), asFixed(startZ)),
    math.Vector3(asFixed(endX), asFixed(GRID_LINE_Y), asFixed(endZ)),
    color,
    asFixed(GRID_LINE_DURATION)
  )
}

function drawRuntimeGridBatch(xMin: number, xMax: number, zMin: number, zMax: number, nextLineIndex: number, totalLines: number, color: unknown): void {
  const xLineCount = math.floor((xMax - xMin) / GRID_CELL_SIZE) + 1
  let lineIndex = nextLineIndex
  const endLineIndex = lineIndex + GRID_LINE_BATCH_SIZE

  while (lineIndex < totalLines && lineIndex < endLineIndex) {
    if (lineIndex < xLineCount) {
      const x = xMin + lineIndex * GRID_CELL_SIZE
      drawRuntimeGridLine(x, zMin, x, zMax, color)
    } else {
      const rowIndex = lineIndex - xLineCount
      const z = zMin + rowIndex * GRID_CELL_SIZE
      drawRuntimeGridLine(xMin, z, xMax, z, color)
    }
    lineIndex += 1
  }

  if (lineIndex < totalLines) {
    ;(LuaAPI as any).call_delay_frame(1, () => {
      drawRuntimeGridBatch(xMin, xMax, zMin, zMax, lineIndex, totalLines, color)
    })
    return
  }

}

export function drawRuntimeTileGrid(): void {
  if (runtimeGridDrawStarted) {
    return
  }
  runtimeGridDrawStarted = true
  if (!GRID_LINES_VISIBLE) {
    return
  }

  let xMin = 999999
  let xMax = -999999
  let zMin = 999999
  let zMax = -999999
  for (let moduleIndex = 0; moduleIndex <= RUNTIME_COPY_COUNT; moduleIndex++) {
    const floor = getRuntimeFloorForModule(moduleIndex)
    const centerX = getRuntimeModuleCenterX(moduleIndex)
    xMin = math.min(xMin, centerX - floor.sx / 2)
    xMax = math.max(xMax, centerX + floor.sx / 2)
    zMin = math.min(zMin, floor.z - floor.sz / 2)
    zMax = math.max(zMax, floor.z + floor.sz / 2)
  }
  const xLineCount = math.floor((xMax - xMin) / GRID_CELL_SIZE) + 1
  const zLineCount = math.floor((zMax - zMin) / GRID_CELL_SIZE) + 1
  const totalLines = xLineCount + zLineCount
  const color = (GlobalAPI as any).str_to_color(GRID_LINE_COLOR)

  drawRuntimeGridBatch(xMin, xMax, zMin, zMax, 0, totalLines, color)
}
