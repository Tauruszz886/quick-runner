export const THIRD_VANISHING_TAG = "ZLJ_VANISHING_PLATFORM"

export const THIRD_CHAIN_DELAY_SECONDS = 0.3
export const THIRD_WAIT_BEFORE_FADE_SECONDS = 0.1
export const THIRD_FADE_SECONDS = 0.5
export const THIRD_FADE_FRAMES = 10
export const THIRD_FADE_STEP_FRAMES = 5
export const THIRD_DISAPPEAR_SECONDS = 0.8

export const THIRD_PLATFORM_BLUE = 0x0066ff as Color
export const THIRD_PLATFORM_RED = 0xff0000 as Color

export const THIRD_FADE_STEP_COLORS: readonly Color[] = [
  THIRD_PLATFORM_BLUE,
  0x5544aa as Color,
  0xaa2255 as Color,
  THIRD_PLATFORM_RED,
]

export const THIRD_FADE_STEP_OPACITY: readonly number[] = [1, 2 / 3, 1 / 3, 0]

export const THIRD_TOUCH_OUTLINE_WIDTH = 3
export const THIRD_TOUCH_OUTLINE_COLOR = 0xff0000 as Color
export const THIRD_PAINT_AREAS = [1, 2, 3, 4] as const

export const THIRD_CHAIN_GROUPS: readonly (readonly string[])[] = [
  ["第03关_dxf_848_24x17_1875", "第03关_dxf_844_24x17_1875", "第03关_dxf_840_24x17_1875"],
  ["第03关_dxf_84C_24x17_1875", "第03关_dxf_858_24x17_1875", "第03关_dxf_85C_24x17_1875"],
  ["第03关_dxf_850_24x17_1875", "第03关_dxf_86C_24x17_1875", "第03关_dxf_860_24x17_1875"],
  ["第03关_dxf_854_24x17_1875", "第03关_dxf_868_24x17_1875", "第03关_dxf_864_24x17_1875"],
]

export function normalizeThirdVanishingPlatformName(name: string): string {
  return name.substring(0, 3) === "QR_" ? name.substring(3) : name
}

export function isThirdLevelVanishingPlatformName(name: string): boolean {
  const normalized = normalizeThirdVanishingPlatformName(name)
  for (let groupIndex = 0; groupIndex < THIRD_CHAIN_GROUPS.length; groupIndex++) {
    const group = THIRD_CHAIN_GROUPS[groupIndex]!
    for (let i = 0; i < group.length; i++) {
      if (group[i] === normalized) {
        return true
      }
    }
  }
  return false
}

export function getThirdChainFromName(name: string): string[] | undefined {
  const normalized = normalizeThirdVanishingPlatformName(name)
  for (let groupIndex = 0; groupIndex < THIRD_CHAIN_GROUPS.length; groupIndex++) {
    const group = THIRD_CHAIN_GROUPS[groupIndex]!
    for (let i = 0; i < group.length; i++) {
      if (group[i] === normalized) {
        const out: string[] = []
        for (let j = i; j < group.length; j++) {
          out.push(group[j]!)
        }
        return out
      }
    }
  }
  return undefined
}
