export const TAG = "ZLJ_MAIN"
export const SPEED_TAG = "ZLJ_SPEED_UI"
export const FLOOR_TAG = "ZLJ_RUNTIME_FLOOR"
export const TILE_TAG = "ZLJ_RUNTIME_TILE"
export const WALL_TAG = "ZLJ_RUNTIME_WALL"
export const CEILING_TAG = "ZLJ_RUNTIME_CEILING"
export const GRID_TAG = "ZLJ_RUNTIME_GRID"
export const TERRAIN_TAG = "ZLJ_RUNTIME_TERRAIN"

export const DASHBOARD_CENTER_X = 450
export const DASHBOARD_CENTER_Y = 540
export const DASHBOARD_OPACITY = 0.75
export const DEFAULT_SPEED = 5
export const TRIGGER_RETURN_TO_BIRTH_ENABLED = true
export const WALL_PREFAB_ID = 105205
export const LEVEL_FLOOR_PREFAB_ID = WALL_PREFAB_ID
export const LEVEL_FLOOR_PAINT_AREA_COLORS = [
  35071 as Color,
  3795 as Color,
  255 as Color,
  16777215 as Color,
] as const

export const FLOOR_BASE_Y = 0
export const TILE_BASE_Y = 3
export const BIRTH_TILE_BASE_Y = 3.5
export const TILE_HEIGHT = 3
export const BIRTH_SPAWN_X = 919
export const BIRTH_SPAWN_Y = 8
export const BIRTH_SPAWN_Z = -36
export const FIRST_LEVEL_TERRAIN_BASE_Y = 3.5
export const WALL_BASE_Y = 2
export const WALL_HEIGHT = 45
export const CEILING_BASE_Y = 46.5
export const RUNTIME_COPY_COUNT = 10
export const RUNTIME_FLOOR_CREATE_BATCH_SIZE = 2
export const RUNTIME_WALL_CREATE_DELAY_SECONDS = 1
export const RUNTIME_CEILING_CREATE_DELAY_SECONDS = 2
export const RUNTIME_TILE_CREATE_DELAY_SECONDS = 3

export const GRID_CELL_SIZE = 1
export const GRID_LINE_Y = TILE_BASE_Y + TILE_HEIGHT + 0.05
export const GRID_LINE_DURATION = 9999
export const GRID_LINE_BATCH_SIZE = 220
export const GRID_LINE_COLOR = "00E5FF"
export const GRID_LINES_VISIBLE = false

export const EXPANDED_FLOOR_START_MODULE_INDEX = 1
export const EXPANDED_FLOOR_END_MODULE_INDEX = 10
export const EXPANDED_RUNTIME_FLOOR_SY = 3
export const SIDE_WALL_THICKNESS = 2
export const SIDE_WALL_INSET = 0.5
export const WEST_WALL_OPENING_GAP_SZ = 19

export const FIFTH_LEVEL_TERRAIN_MODULE_INDEX = 5
export const EIGHTH_LEVEL_TERRAIN_MODULE_INDEX = 8
export const NINTH_LEVEL_TERRAIN_MODULE_INDEX = 9
export const TENTH_LEVEL_TERRAIN_MODULE_INDEX = 10
export const FIRST_LEVEL_TERRAIN_HEIGHT = 3
export const EIGHTH_LEVEL_TERRAIN_CREATE_BATCH_SIZE = 8
export const EIGHTH_LEVEL_MECHANISM_CENTER_RAISE_Y = 5.5
export const EIGHTH_LEVEL_MOVING_LONG_PLATE_EXTRA_RAISE_Y = -1
export const EIGHTH_LEVEL_SMALL_CROSSBAR_EXTRA_RAISE_Y = 0.75
export const EIGHTH_LEVEL_FIXED_HIGH_BAR_HEIGHT = 9.5
export const EIGHTH_LEVEL_MECHANISM_MOVE_Z = 3.5
export const EIGHTH_LEVEL_MECHANISM_SPLIT_Z = 63.75
export const EIGHTH_LEVEL_MECHANISM_MOVE_SECONDS = 1
export const EIGHTH_LEVEL_MECHANISM_MOVE_FRAMES = 35

export const FOURTH_LEVEL_PRESS_PLATE_FLOAT_GAP = 10
export const FOURTH_LEVEL_COMPRESSOR_HEIGHT = 5
export const FOURTH_LEVEL_COMPRESSOR_START_Y =
  FIRST_LEVEL_TERRAIN_BASE_Y + FIRST_LEVEL_TERRAIN_HEIGHT + FOURTH_LEVEL_PRESS_PLATE_FLOAT_GAP
export const FOURTH_LEVEL_COMPRESSOR_DOWN_Y = FIRST_LEVEL_TERRAIN_BASE_Y + FIRST_LEVEL_TERRAIN_HEIGHT
export const FOURTH_LEVEL_COMPRESSOR_WAIT_SECONDS = 3
export const FOURTH_LEVEL_COMPRESSOR_DOWN_SECONDS = 1.5
export const FOURTH_LEVEL_COMPRESSOR_DOWN_STEPS = 30
export const FOURTH_LEVEL_COMPRESSOR_UP_FRAMES = 18
export const FOURTH_LEVEL_COMPRESSOR_HOLD_SECONDS = 2

export type RuntimeFloor = {
  name: string
  x: number
  z: number
  sx: number
  sy: number
  sz: number
}

export type RuntimeCeiling = {
  name: string
  x: number
  z: number
  sx: number
  sy: number
  sz: number
}

export type RuntimeWall = {
  name: string
  side: "north" | "east" | "south" | "west"
  x: number
  z: number
  sx: number
  sz: number
}

export type RuntimeTerrainPiece = {
  name: string
  startX: number
  startZ: number
  sx: number
  sy: number
  sz: number
  baseY?: number
  prefabId?: number
  compressor?: boolean
  compressorDownY?: number
}

export const RUNTIME_FLOOR: RuntimeFloor = {
  name: "地板",
  x: 919,
  z: -36,
  sx: 160,
  sy: 2,
  sz: 100,
}

export const RUNTIME_CEILING: RuntimeCeiling = {
  name: "天花板",
  x: 919,
  z: -36,
  sx: 160,
  sy: 1.5,
  sz: 100,
}
