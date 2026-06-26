import { safeCall } from "@common/engine_safe"
import { TERRAIN_TAG } from "../config"
import type { RuntimeSceneUnit } from "./runtime_scene_scan"

const THIRD_LEVEL_EXPECTED_TILE_NAMES: readonly string[] = [
  "第03关_dxf_840_24x17_1875",
  "第03关_dxf_85C_24x17_1875",
  "第03关_dxf_860_24x17_1875",
  "第03关_dxf_864_24x17_1875",
  "第03关_dxf_844_24x17_1875",
  "第03关_dxf_858_24x17_1875",
  "第03关_dxf_86C_24x17_1875",
  "第03关_dxf_868_24x17_1875",
  "第03关_dxf_848_24x17_1875",
  "第03关_dxf_84C_24x17_1875",
  "第03关_dxf_850_24x17_1875",
  "第03关_dxf_854_24x17_1875",
]

function normalizeRuntimeName(name: string): string {
  return name.substring(0, 3) === "QR_" ? name.substring(3) : name
}

function isExpectedThirdLevelTile(name: string): boolean {
  const normalized = normalizeRuntimeName(name)
  for (let i = 0; i < THIRD_LEVEL_EXPECTED_TILE_NAMES.length; i++) {
    if (THIRD_LEVEL_EXPECTED_TILE_NAMES[i] === normalized) {
      return true
    }
  }
  return false
}

function queryUnitByName(name: string): unknown {
  const direct = safeCall(
    () => {
      return (LuaAPI as any).query_unit(name)
    },
    { tag: `third_tile_diag_query_${name}`, fallback: null, logger: print }
  )
  if (direct !== null && direct !== undefined) {
    return direct
  }
  return safeCall(
    () => {
      return (LuaAPI as any).query_unit(`QR_${name}`)
    },
    { tag: `third_tile_diag_query_QR_${name}`, fallback: null, logger: print }
  )
}

function joinNames(names: string[]): string {
  return names.length === 0 ? "-" : names.join(",")
}

export function printThirdLevelTileScanDiagnostics(sceneUnits: RuntimeSceneUnit[]): void {
  const foundByRole: Record<string, boolean> = {}
  const extraByRole: string[] = []
  for (let i = 0; i < sceneUnits.length; i++) {
    const item = sceneUnits[i]!
    if (item.role !== "third_vanishing_platform") {
      continue
    }
    const normalized = normalizeRuntimeName(item.runtimeName)
    if (isExpectedThirdLevelTile(normalized)) {
      foundByRole[normalized] = true
    } else if (item.module === 3) {
      extraByRole.push(normalized)
    }
  }

  const missingByRole: string[] = []
  const missingByNameQuery: string[] = []
  let roleFound = 0
  let directQueryFound = 0
  for (let i = 0; i < THIRD_LEVEL_EXPECTED_TILE_NAMES.length; i++) {
    const name = THIRD_LEVEL_EXPECTED_TILE_NAMES[i]!
    if (foundByRole[name] === true) {
      roleFound += 1
    } else {
      missingByRole.push(name)
    }
    const unit = queryUnitByName(name)
    if (unit !== null && unit !== undefined) {
      directQueryFound += 1
    } else {
      missingByNameQuery.push(name)
    }
  }

  print(
    `[${TERRAIN_TAG}] third_level_tile_snapshot expected=${THIRD_LEVEL_EXPECTED_TILE_NAMES.length} role_scan=${roleFound} direct_query=${directQueryFound} role_scan_ok=${roleFound === THIRD_LEVEL_EXPECTED_TILE_NAMES.length} direct_query_ok=${directQueryFound === THIRD_LEVEL_EXPECTED_TILE_NAMES.length}`
  )
  if (missingByRole.length > 0) {
    print(`[${TERRAIN_TAG}] third_level_tile_snapshot missing_by_role=${joinNames(missingByRole)}`)
  }
  if (missingByNameQuery.length > 0) {
    print(`[${TERRAIN_TAG}] third_level_tile_snapshot missing_by_direct_query=${joinNames(missingByNameQuery)}`)
  }
  if (extraByRole.length > 0) {
    print(`[${TERRAIN_TAG}] third_level_tile_snapshot extra_role_module3=${joinNames(extraByRole)}`)
  }
}
