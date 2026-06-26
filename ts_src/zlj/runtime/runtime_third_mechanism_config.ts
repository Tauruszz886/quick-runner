export const THIRD_LEVEL_TERRAIN_MODULE_INDEX = 3

export const THIRD_LEVEL_CYCLE_SECONDS = 11
export const THIRD_LEVEL_VISIBLE_SECONDS = 2
export const THIRD_LEVEL_WARNING_SECONDS = 1
export const THIRD_LEVEL_HIDDEN_SECONDS = 2

export const THIRD_LEVEL_WARNING_COLOR = 0xff0000 as Color
export const THIRD_LEVEL_NORMAL_COLOR = 0xffffff as Color
export const THIRD_LEVEL_HIDDEN_Y_OFFSET = 12

export type ThirdLevelTimedPlatformSpec = {
  pieceName: string
  label: number
  groupName: string
  startOffsetSeconds: number
}

export const THIRD_LEVEL_TIMED_PLATFORM_SPECS: readonly ThirdLevelTimedPlatformSpec[] = [] as const
