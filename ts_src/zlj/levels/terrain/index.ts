export type { LevelTerrainFrame, LevelTerrainSpec } from "../shared/types"
import type { LevelTerrainSpec } from "../shared/types"
export { LEVEL_TERRAIN_FRAMES } from "../shared/frames"
import { LEVEL_01_TERRAIN } from "../level_01/terrain"
import { LEVEL_02_TERRAIN } from "../level_02/terrain"
import { LEVEL_03_TERRAIN } from "../level_03/terrain"
import { LEVEL_04_TERRAIN } from "../level_04/terrain"
import { LEVEL_05_TERRAIN } from "../level_05/terrain"
import { LEVEL_06_TERRAIN } from "../level_06/terrain"
import { LEVEL_07_TERRAIN } from "../level_07/terrain"
import { LEVEL_08_TERRAIN } from "../level_08/terrain"
import { LEVEL_09_TERRAIN } from "../level_09/terrain"
import { LEVEL_10_TERRAIN } from "../level_10/terrain"

export const LEVEL_TERRAIN_SPECS: Record<number, readonly LevelTerrainSpec[]> = {
  1: LEVEL_01_TERRAIN,
  2: LEVEL_02_TERRAIN,
  3: LEVEL_03_TERRAIN,
  4: LEVEL_04_TERRAIN,
  5: LEVEL_05_TERRAIN,
  6: LEVEL_06_TERRAIN,
  7: LEVEL_07_TERRAIN,
  8: LEVEL_08_TERRAIN,
  9: LEVEL_09_TERRAIN,
  10: LEVEL_10_TERRAIN,
}
