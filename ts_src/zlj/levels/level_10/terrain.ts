import type { LevelTerrainSpec } from "../shared/types"

const LEVEL_FRAME_SX = 160
const RAIL_PREFAB_ID = 3301506
const LOCATOR_WIDTH = 0.2
const RAIL_WIDTH = 1
const RAIL_HEIGHT = 1
const RAIL_LENGTH = 20
const RAIL_SEGMENT_LENGTH = 1
const RAIL_START_Z = 40
const RAIL_BASE_Y = 6.5
const RAIL_STACK_STEP_Y = 1

function flipX(startX: number, sx: number): number {
  return LEVEL_FRAME_SX - startX - sx
}

function getFlippedLocatorCenterX(startX: number): number {
  return flipX(startX, LOCATOR_WIDTH) + LOCATOR_WIDTH / 2
}

function createRailSegments(sourceName: string, sourceStartX: number, baseY: number): LevelTerrainSpec[] {
  const specs: LevelTerrainSpec[] = []
  const count = math.floor(RAIL_LENGTH / RAIL_SEGMENT_LENGTH)
  const startX = getFlippedLocatorCenterX(sourceStartX) - RAIL_WIDTH / 2
  for (let i = 0; i < count; i++) {
    specs.push({
      name: `${sourceName}_3301506_${i + 1}`,
      startX,
      startZ: RAIL_START_Z + i * RAIL_SEGMENT_LENGTH,
      sx: RAIL_WIDTH,
      sy: RAIL_HEIGHT,
      sz: RAIL_SEGMENT_LENGTH,
      baseY,
      prefabId: RAIL_PREFAB_ID,
    })
  }
  return specs
}

export const LEVEL_10_TERRAIN: readonly LevelTerrainSpec[] = [
  { name: "dxf_73C_15x40", startX: flipX(0, 15), startZ: 30, sx: 15, sy: 3, sz: 40 },
  { name: "dxf_75C_115x20", startX: flipX(25, 115), startZ: 40, sx: 115, sy: 3, sz: 20 },
  { name: "dxf_737_15x40", startX: flipX(145, 15), startZ: 30, sx: 15, sy: 3, sz: 40 },
  ...createRailSegments("dxf_97B_1", 26, RAIL_BASE_Y),
  ...createRailSegments("dxf_97B_2", 26, RAIL_BASE_Y + RAIL_STACK_STEP_Y),
  ...createRailSegments("dxf_97B_3", 26, RAIL_BASE_Y + RAIL_STACK_STEP_Y * 2),
  ...createRailSegments("dxf_97F_1", 75, RAIL_BASE_Y),
  ...createRailSegments("dxf_983_1", 115, RAIL_BASE_Y),
]
