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

export const THIRD_LEVEL_TIMED_PLATFORM_SPECS: readonly ThirdLevelTimedPlatformSpec[] = [
  { pieceName: "dxf_864_24x17_1875", label: 5, groupName: "G1", startOffsetSeconds: 0 },
  { pieceName: "dxf_868_24x17_1875", label: 9, groupName: "G1", startOffsetSeconds: 1.5 },
  { pieceName: "dxf_854_24x17_1875", label: 13, groupName: "G1", startOffsetSeconds: 3 },

  { pieceName: "dxf_860_24x17_1875", label: 4, groupName: "G2", startOffsetSeconds: 0.7 },
  { pieceName: "dxf_86C_24x17_1875", label: 8, groupName: "G2", startOffsetSeconds: 2.2 },
  { pieceName: "dxf_850_24x17_1875", label: 12, groupName: "G2", startOffsetSeconds: 3.7 },

  { pieceName: "dxf_85C_24x17_1875", label: 3, groupName: "G3", startOffsetSeconds: 1.4 },
  { pieceName: "dxf_858_24x17_1875", label: 7, groupName: "G3", startOffsetSeconds: 2.9 },
  { pieceName: "dxf_84C_24x17_1875", label: 11, groupName: "G3", startOffsetSeconds: 4.4 },

  { pieceName: "dxf_840_24x17_1875", label: 2, groupName: "G4", startOffsetSeconds: 2.1 },
  { pieceName: "dxf_844_24x17_1875", label: 6, groupName: "G4", startOffsetSeconds: 3.6 },
  { pieceName: "dxf_848_24x17_1875", label: 10, groupName: "G4", startOffsetSeconds: 5.1 },
] as const
