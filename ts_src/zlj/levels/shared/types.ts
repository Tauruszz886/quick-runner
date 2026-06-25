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
