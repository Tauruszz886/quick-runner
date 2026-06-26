import { safeCall } from "@common/engine_safe"
import { asFixed } from "../../layout"
import {
  getThirdChainFromName,
  normalizeThirdVanishingPlatformName,
  THIRD_CHAIN_DELAY_SECONDS,
  THIRD_DISAPPEAR_SECONDS,
  THIRD_FADE_FRAMES,
  THIRD_FADE_STEP_COLORS,
  THIRD_FADE_STEP_FRAMES,
  THIRD_FADE_STEP_OPACITY,
  THIRD_PLATFORM_BLUE,
  THIRD_VANISHING_TAG,
  THIRD_WAIT_BEFORE_FADE_SECONDS,
} from "./vanishing_platform_config"
import {
  applyThirdPlatformTouchOutline,
  clearThirdPlatformTouchOutline,
  restoreThirdPlatformPhysics,
  setThirdPlatformModelPhysicVisible,
  setThirdPlatformModelVisible,
  setThirdPlatformOpacity,
  setThirdPlatformPaintColor,
  type ThirdVanishingPlatformUnit,
} from "./vanishing_platform_engine"

export type ThirdVanishingPlatform = ThirdVanishingPlatformUnit & {
  fading: boolean
  hidden: boolean
  generation: number
}

export type ThirdVanishingPlatformLookup = Record<string, ThirdVanishingPlatform>

function scheduleDelay(seconds: number, callback: () => void): void {
  safeCall(
    () => {
      ;(LuaAPI as any).call_delay_time(asFixed(seconds), callback)
    },
    { tag: `third_vanishing_delay_${seconds}`, fallback: undefined, logger: print }
  )
}

function scheduleNextFrame(callback: () => void): void {
  safeCall(
    () => {
      ;(LuaAPI as any).call_delay_frame(1, callback)
    },
    { tag: "third_vanishing_delay_frame", fallback: undefined, logger: print }
  )
}

export function initializeThirdVanishingPlatform(platform: ThirdVanishingPlatform): void {
  setThirdPlatformPaintColor(platform, THIRD_PLATFORM_BLUE)
}

export function resetThirdVanishingPlatform(platform: ThirdVanishingPlatform, source: string): void {
  setThirdPlatformPaintColor(platform, THIRD_PLATFORM_BLUE)
  restoreThirdPlatformPhysics(platform, `reset:${source}`)
}

export function clearThirdVanishingPlatformOutline(platform: ThirdVanishingPlatform, reason: string): void {
  clearThirdPlatformTouchOutline(platform, reason)
}

function restoreThirdPlatform(platform: ThirdVanishingPlatform): void {
  platform.fading = false
  platform.hidden = false
  clearThirdPlatformTouchOutline(platform, "cycle_restore")
  setThirdPlatformModelVisible(platform, true)
  setThirdPlatformOpacity(platform, 1)
  setThirdPlatformPaintColor(platform, THIRD_PLATFORM_BLUE)
  restoreThirdPlatformPhysics(platform, "cycle_restore")
}

function getThirdFadeStep(frame: number): number {
  if (frame >= THIRD_FADE_FRAMES) {
    return 3
  }
  if (frame >= THIRD_FADE_STEP_FRAMES * 2) {
    return 2
  }
  if (frame >= THIRD_FADE_STEP_FRAMES) {
    return 1
  }
  return 0
}

function fadeThirdPlatform(platform: ThirdVanishingPlatform, generation: number): void {
  let frame = 0
  const tick = (): void => {
    if (generation !== platform.generation || !platform.fading) {
      return
    }
    frame += 1
    const fadeStep = getThirdFadeStep(frame)
    setThirdPlatformOpacity(platform, THIRD_FADE_STEP_OPACITY[fadeStep]!)
    setThirdPlatformPaintColor(platform, THIRD_FADE_STEP_COLORS[fadeStep]!)
    if (frame < THIRD_FADE_FRAMES) {
      scheduleNextFrame(tick)
      return
    }
    platform.hidden = true
    platform.fading = false
    clearThirdPlatformTouchOutline(platform, "disappear")
    setThirdPlatformModelPhysicVisible(platform, false)
    scheduleDelay(THIRD_DISAPPEAR_SECONDS, () => {
      if (generation !== platform.generation) {
        return
      }
      restoreThirdPlatform(platform)
    })
  }
  tick()
}

function startThirdPlatformCycle(platform: ThirdVanishingPlatform, source: string): void {
  if (platform.fading || platform.hidden) {
    print(`[${THIRD_VANISHING_TAG}] third fade skipped name=${platform.name} source=${source} reason=busy`)
    return
  }
  platform.generation += 1
  const generation = platform.generation
  platform.fading = true
  platform.hidden = false
  applyThirdPlatformTouchOutline(platform, "cycle_start")
  restoreThirdPlatformPhysics(platform, "cycle_start")
  setThirdPlatformModelVisible(platform, true)
  setThirdPlatformOpacity(platform, 1)
  setThirdPlatformPaintColor(platform, THIRD_PLATFORM_BLUE)
  scheduleDelay(THIRD_WAIT_BEFORE_FADE_SECONDS, () => {
    if (generation !== platform.generation || !platform.fading) {
      return
    }
    fadeThirdPlatform(platform, generation)
  })
}

export function startThirdVanishingPlatformChain(
  platform: ThirdVanishingPlatform,
  source: string,
  platformsByName: ThirdVanishingPlatformLookup
): void {
  const chain = getThirdChainFromName(platform.name)
  if (chain === undefined) {
    startThirdPlatformCycle(platform, source)
    return
  }
  for (let i = 0; i < chain.length; i++) {
    const targetName = chain[i]!
    const target = platformsByName[normalizeThirdVanishingPlatformName(targetName)]
    if (target === undefined) {
      print(`[${THIRD_VANISHING_TAG}] third chain target missing source=${platform.name} target=${targetName}`)
      continue
    }
    const delay = i * THIRD_CHAIN_DELAY_SECONDS
    scheduleDelay(delay, () => startThirdPlatformCycle(target, `${source}:chain:${platform.name}:${i}`))
  }
}
