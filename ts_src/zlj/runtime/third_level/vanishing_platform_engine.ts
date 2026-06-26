import { safeCall } from "@common/engine_safe"
import { asFixed } from "../../layout"
import {
  THIRD_PAINT_AREAS,
  THIRD_TOUCH_OUTLINE_COLOR,
  THIRD_TOUCH_OUTLINE_WIDTH,
} from "./vanishing_platform_config"

export type ThirdVanishingPlatformUnit = {
  name: string
  unit: unknown
}

export function setThirdPlatformOpacity(platform: ThirdVanishingPlatformUnit, opacity: number): void {
  safeCall(
    () => {
      const target = platform.unit as any
      if (target.set_opacity !== undefined && target.set_opacity !== null) {
        target.set_opacity(asFixed(opacity))
      }
    },
    { tag: `third_vanishing_set_opacity_${platform.name}`, fallback: undefined, logger: print }
  )
}

export function setThirdPlatformModelVisible(platform: ThirdVanishingPlatformUnit, visible: boolean): void {
  safeCall(
    () => {
      const target = platform.unit as any
      if (target.set_model_visible !== undefined && target.set_model_visible !== null) {
        target.set_model_visible(visible)
      }
    },
    { tag: `third_vanishing_set_model_visible_${platform.name}`, fallback: undefined, logger: print }
  )
}

export function setThirdPlatformModelPhysicVisible(platform: ThirdVanishingPlatformUnit, visible: boolean): void {
  safeCall(
    () => {
      const target = platform.unit as any
      if (target.set_model_physic_visible !== undefined && target.set_model_physic_visible !== null) {
        target.set_model_physic_visible(visible)
      }
    },
    { tag: `third_vanishing_set_model_physic_visible_${platform.name}`, fallback: undefined, logger: print }
  )
}

function setThirdPlatformPhysicsActive(platform: ThirdVanishingPlatformUnit, active: boolean): void {
  safeCall(
    () => {
      const target = platform.unit as any
      if (target.set_physics_active !== undefined && target.set_physics_active !== null) {
        target.set_physics_active(active)
      }
    },
    { tag: `third_vanishing_set_physics_active_${platform.name}`, fallback: undefined, logger: print }
  )
}

function setThirdPlatformPhysicEnable(platform: ThirdVanishingPlatformUnit, active: boolean): void {
  safeCall(
    () => {
      const target = platform.unit as any
      if (target.set_physic_enable !== undefined && target.set_physic_enable !== null) {
        target.set_physic_enable(active)
      }
    },
    { tag: `third_vanishing_set_physic_enable_${platform.name}`, fallback: undefined, logger: print }
  )
}

function setThirdPlatformCollision(platform: ThirdVanishingPlatformUnit, active: boolean): void {
  safeCall(
    () => {
      const target = platform.unit as any
      if (target.enable_collision !== undefined && target.enable_collision !== null) {
        target.enable_collision(active)
      }
    },
    { tag: `third_vanishing_enable_collision_${platform.name}`, fallback: undefined, logger: print }
  )
}

export function restoreThirdPlatformPhysics(platform: ThirdVanishingPlatformUnit, reason: string): void {
  setThirdPlatformModelPhysicVisible(platform, true)
  setThirdPlatformPhysicsActive(platform, true)
  setThirdPlatformPhysicEnable(platform, true)
  setThirdPlatformCollision(platform, true)
}

export function setThirdPlatformPaintColor(platform: ThirdVanishingPlatformUnit, color: Color): void {
  for (let i = 0; i < THIRD_PAINT_AREAS.length; i++) {
    const area = THIRD_PAINT_AREAS[i]! as PaintArea
    safeCall(
      () => {
        const target = platform.unit as any
        if (target.set_paint_area_color !== undefined && target.set_paint_area_color !== null) {
          target.set_paint_area_color(area, color)
        }
      },
      { tag: `third_vanishing_set_paint_${platform.name}_${i + 1}`, fallback: undefined, logger: print }
    )
  }
}

function forEachValidRole(callback: (role: unknown) => void, tag: string): void {
  safeCall(
    () => {
      const roles = (GameAPI as any).get_all_valid_roles()
      for (const role of roles as unknown[]) {
        callback(role)
      }
    },
    { tag, fallback: undefined, logger: print }
  )
}

export function applyThirdPlatformTouchOutline(platform: ThirdVanishingPlatformUnit, reason: string): void {
  forEachValidRole(
    (role) => {
      const target = role as any
      if (target.set_unit_outline === undefined || target.set_unit_outline === null) {
        return
      }
      safeCall(
        () => {
          target.set_unit_outline(platform.unit, THIRD_TOUCH_OUTLINE_WIDTH, THIRD_TOUCH_OUTLINE_COLOR)
        },
        { tag: `third_vanishing_touch_outline_${platform.name}`, fallback: undefined, logger: print }
      )
    },
    `third_vanishing_touch_outline_roles_${platform.name}`
  )
}

export function clearThirdPlatformTouchOutline(platform: ThirdVanishingPlatformUnit, reason: string): void {
  forEachValidRole(
    (role) => {
      const target = role as any
      if (target.disable_unit_outline === undefined || target.disable_unit_outline === null) {
        return
      }
      safeCall(
        () => {
          target.disable_unit_outline(platform.unit)
        },
        { tag: `third_vanishing_clear_outline_${platform.name}`, fallback: undefined, logger: print }
      )
    },
    `third_vanishing_clear_outline_roles_${platform.name}`
  )
}
