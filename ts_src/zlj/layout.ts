import { LEVEL_TERRAIN_FRAMES } from "./levels/terrain"
import {
  EXPANDED_FLOOR_END_MODULE_INDEX,
  EXPANDED_FLOOR_START_MODULE_INDEX,
  EXPANDED_RUNTIME_FLOOR_SY,
  RUNTIME_FLOOR,
  type RuntimeFloor,
} from "./config"

export function runtimeModuleLabel(moduleIndex: number): string {
  return moduleIndex === 0 ? "出生地" : `第${moduleIndex}关`
}

export function runtimeModuleName(name: string, moduleIndex: number): string {
  return `${runtimeModuleLabel(moduleIndex)}_${name}`
}

export function isExpandedFloorModule(moduleIndex: number): boolean {
  return moduleIndex >= EXPANDED_FLOOR_START_MODULE_INDEX && moduleIndex <= EXPANDED_FLOOR_END_MODULE_INDEX
}

export function getRuntimeFloorForModule(moduleIndex: number): RuntimeFloor {
  const frame = LEVEL_TERRAIN_FRAMES[moduleIndex]
  if (frame !== undefined) {
    return {
      name: RUNTIME_FLOOR.name,
      x: RUNTIME_FLOOR.x,
      z: RUNTIME_FLOOR.z,
      sx: frame.sx,
      sy: EXPANDED_RUNTIME_FLOOR_SY,
      sz: frame.sz,
    }
  }
  return RUNTIME_FLOOR
}

export function getRuntimeModuleCenterX(moduleIndex: number): number {
  if (moduleIndex <= 0) {
    return RUNTIME_FLOOR.x
  }

  let x = RUNTIME_FLOOR.x
  let previousFloor = getRuntimeFloorForModule(0)
  for (let i = 1; i <= moduleIndex; i++) {
    const currentFloor = getRuntimeFloorForModule(i)
    x -= previousFloor.sx / 2 + currentFloor.sx / 2
    previousFloor = currentFloor
  }
  return x
}

export function getRuntimeTerrainFrameForModule(_moduleIndex: number, floor: RuntimeFloor): RuntimeFloor {
  return floor
}

export function asFixed(value: number): Fixed {
  return (value + 0.1 - 0.1) as Fixed
}
