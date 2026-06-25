export type LevelTerrainSpec = {
  name: string
  startX: number
  startZ: number
  sx: number
  sy: number
  sz: number
  baseY?: number
  prefabId?: number
  role?: "fourth_compressor"
}

export type LevelTerrainFrame = {
  sx: number
  sz: number
}

export type FallDeathZoneSpec = {
  module: number
  name: string
  startX: number
  startZ: number
  sx: number
  sz: number
}

export type RuntimeSceneBindingRole =
  | "second_chaser_surface"
  | "third_timed_platform"
  | "fourth_compressor"
  | "eighth_moving_part"
  | "ninth_vanishing_platform"
  | "tenth_current"

export type RuntimeSceneBinding = {
  module: number
  component: string
  role: RuntimeSceneBindingRole
  moveZ?: number
  moving?: boolean
}
