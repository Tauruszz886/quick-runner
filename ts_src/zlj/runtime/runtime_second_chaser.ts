import { safeCall, safeCreateCustomTriggerSpace } from "@common/engine_safe"
import { EventBus } from "@common/event_bus"
import { TriggerHub } from "@common/trigger_hub"
import { FIRST_LEVEL_TERRAIN_BASE_Y, FIRST_LEVEL_TERRAIN_HEIGHT } from "../config"
import { eliminateUnitAndRebirthAtBirth } from "../birth/rebirth"
import { asFixed, getRuntimeFloorForModule, getRuntimeModuleCenterX } from "../layout"
import { getOnlineRoles, roleKey } from "./runtime_roles"
import { GAME_EVENTS } from "./GameEvents"

const TAG = "ZLJ_SECOND_CHASER"
const MODULE_INDEX = 2
const CHASER_PREFAB_ID = 1073741929
const CHASER_EDITOR_UNIT_NAME = "QR_第02关_追击球"
const DEATH_TRIGGER_PREFAB_ID = 3101010
const CHASER_SIZE = 2
const DEATH_TRIGGER_SIZE = 2.6
const DEATH_HIT_RADIUS = DEATH_TRIGGER_SIZE / 2
const CHASE_RADIUS = 50
const CHASE_SPEED = 7.5
const TICK_SECONDS = 0.05
const TARGET_LOCK_TICKS = 6
const ROLL_RADIUS = CHASER_SIZE / 2
const CHASER_FLOOR_TOP_Y = FIRST_LEVEL_TERRAIN_BASE_Y + FIRST_LEVEL_TERRAIN_HEIGHT
const CHASER_REST_Y = CHASER_FLOOR_TOP_Y + ROLL_RADIUS
const CHASER_SPAWN_Y = CHASER_REST_Y
const CHASER_MASS = 1
const CHASER_FRICTION_COEFFICIENT = 1.2
const CHASER_ROLLING_RESISTANCE = 0.02
const CHASER_BOUNCINESS = 0
const CHASER_ACCELERATION_SECONDS = 0.6
const CHASER_PUSH_FORCE = CHASER_MASS * (CHASE_SPEED / CHASER_ACCELERATION_SECONDS)
const CHASER_PUSH_POINT_HEIGHT = ROLL_RADIUS * 0.55
const ROLL_ANGULAR_ASSIST = 1
const STOP_DISTANCE = 0.4
const MAX_HORIZONTAL_SPEED = CHASE_SPEED * 1.15
const MAX_ROLL_ANGULAR_SPEED = MAX_HORIZONTAL_SPEED / ROLL_RADIUS
const SINK_RESCUE_TOLERANCE = 0.08
const ROLL_DEBUG_SAMPLE_LIMIT = 8

const SPHERE_MARK_LOCAL_X = 54.967105
const SPHERE_MARK_LOCAL_Z = 51.164887

const MIDDLE_PLATFORM = {
  startX: 24,
  startZ: 12.5,
  sx: 104,
  sz: 74.375,
} as const

const EXIT_A_PLATFORM = {
  startX: 0,
  startZ: 31.25,
  sx: 16,
  sz: 37.5,
} as const

type Rect = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

type Position2 = {
  x: number
  z: number
}

type Position3 = Position2 & {
  y: number
}

type NearestRole = {
  key: string
  pos: Position2
  distanceSq: number
}

let started = false
let stopped = false
let chaserUnit: unknown
let chaserTrigger: unknown
let chaserPosition: Position2 | undefined
let chaserCenterY = CHASER_SPAWN_Y
let debugTickCount = 0
let activeRoleKey: string | undefined
let tickGeneration = 0
let chaserForceDriveEnabled = false
let chaserPointForceDriveEnabled = false
let chaserVelocityControlEnabled = false
let chaserAngularVelocityControlEnabled = false
let lockedTarget: Position2 | undefined
let targetLockTicksLeft = 0
let rollDebugSamples = 0

declare const EVENT: {
  ANY_LIFEENTITY_TRIGGER_SPACE: string
}
declare const Enums: {
  TriggerSpaceEventType: { ENTER: number }
  RigidBodyType: { DYNAMIC: number }
  UnitType: { OBSTACLE: unknown }
  ValueType: { Fixed: unknown }
}

function vec3(x: number, y: number, z: number): unknown {
  return math.Vector3(asFixed(x), asFixed(y), asFixed(z))
}

function horizontalLength(x: number, z: number): number {
  return math.sqrt(x * x + z * z)
}

function getModuleMinX(): number {
  const floor = getRuntimeFloorForModule(MODULE_INDEX)
  return getRuntimeModuleCenterX(MODULE_INDEX) - floor.sx / 2
}

function getModuleMinZ(): number {
  const floor = getRuntimeFloorForModule(MODULE_INDEX)
  return floor.z - floor.sz / 2
}

function localPointToWorld(localX: number, localZ: number): Position2 {
  return {
    x: getModuleMinX() + localX,
    z: getModuleMinZ() + localZ,
  }
}

function localRectToWorld(startX: number, startZ: number, sx: number, sz: number, inset: number): Rect {
  const min = localPointToWorld(startX, startZ)
  return {
    minX: min.x + inset,
    maxX: min.x + sx - inset,
    minZ: min.z + inset,
    maxZ: min.z + sz - inset,
  }
}

function clamp(value: number, min: number, max: number): number {
  return math.max(min, math.min(max, value))
}

function clampToRect(pos: Position2, rect: Rect): Position2 {
  return {
    x: clamp(pos.x, rect.minX, rect.maxX),
    z: clamp(pos.z, rect.minZ, rect.maxZ),
  }
}

function isInsideRect(pos: Position2, rect: Rect): boolean {
  return pos.x >= rect.minX && pos.x <= rect.maxX && pos.z >= rect.minZ && pos.z <= rect.maxZ
}

function positionDistance(a: Position3, b: Position3): number {
  return math.abs(a.x - b.x) + math.abs(a.y - b.y) + math.abs(a.z - b.z)
}

function getRolePosition(role: Role): Position2 | undefined {
  const unit = getRoleUnit(role)
  if (unit === undefined) {
    return undefined
  }
  const pos = safeCall(
    () => {
      return (unit as any).get_position()
    },
    { tag: "second_chaser_get_role_position", fallback: null, logger: print }
  )
  if (pos === null || pos === undefined) {
    return undefined
  }
  return { x: (pos as any).x as number, z: (pos as any).z as number }
}

function getRoleUnit(role: Role): unknown | undefined {
  const character = safeCall(
    () => {
      return (role as any).get_ctrl_unit()
    },
    { tag: "second_chaser_get_ctrl_unit", fallback: null, logger: print }
  )
  if (character === null || character === undefined) {
    return undefined
  }
  return character
}

function findActiveRoleOnAPlatform(aPlatform: Rect): { key: string; pos: Position2 } | undefined {
  if (activeRoleKey === undefined) {
    return undefined
  }
  const roles = getOnlineRoles()
  for (let i = 0; i < roles.length; i++) {
    const key = roleKey(roles[i]!)
    if (key !== activeRoleKey) {
      continue
    }
    const pos = getRolePosition(roles[i]!)
    if (pos !== undefined && isInsideRect(pos, aPlatform)) {
      return { key, pos }
    }
  }
  return undefined
}

function findNearestRoleInRange(center: Position2): Position2 | undefined {
  const nearest = findNearestRole(center)
  if (nearest === undefined || nearest.distanceSq > CHASE_RADIUS * CHASE_RADIUS) {
    return undefined
  }
  return nearest.pos
}

function findNearestRole(center: Position2): NearestRole | undefined {
  const roles = getOnlineRoles()
  let nearest: Position2 | undefined
  let nearestKey: string | undefined
  let nearestDistanceSq = 999999999
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]!
    const pos = getRolePosition(role)
    if (pos === undefined) {
      continue
    }
    const dx = pos.x - center.x
    const dz = pos.z - center.z
    const distanceSq = dx * dx + dz * dz
    if (distanceSq <= nearestDistanceSq) {
      nearest = pos
      nearestKey = roleKey(role)
      nearestDistanceSq = distanceSq
    }
  }
  if (nearest === undefined || nearestKey === undefined) {
    return undefined
  }
  return { key: nearestKey, pos: nearest, distanceSq: nearestDistanceSq }
}

function queryEditorUnit(name: string): unknown {
  const unit = safeCall(
    () => {
      return (LuaAPI as any).query_unit(name)
    },
    { tag: `second_chaser_query_${name}`, fallback: null, logger: print }
  )
  return unit === undefined ? null : unit
}

function queryChaserCandidates(): unknown[] {
  const units = safeCall(
    () => {
      return (LuaAPI as any).query_units_by_type(Enums.UnitType.OBSTACLE, CHASER_PREFAB_ID)
    },
    { tag: "second_chaser_query_candidates", fallback: [] as unknown[], logger: print }
  )
  return units === undefined || units === null ? [] : (units as unknown[])
}

function getUnitPosition3(unit: unknown, fallback: Position3, tag: string): Position3 {
  const pos = safeCall(
    () => {
      return (unit as any).get_position()
    },
    { tag, fallback: null, logger: print }
  ) as { x?: number; y?: number; z?: number } | null
  if (pos === null || pos === undefined || pos.x === undefined || pos.y === undefined || pos.z === undefined) {
    return fallback
  }
  return {
    x: pos.x,
    y: pos.y,
    z: pos.z,
  }
}

function queryEditorChaserByPosition(fallback: Position3): unknown {
  const candidates = queryChaserCandidates()
  let bestUnit: unknown = null
  let bestDistance = 999999
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!
    const pos = getUnitPosition3(candidate, fallback, `second_chaser_candidate_pos_${i + 1}`)
    const distance = positionDistance(pos, fallback)
    if (distance < bestDistance) {
      bestDistance = distance
      bestUnit = candidate
    }
  }
  if (bestUnit !== null && bestDistance <= 0.5) {
    print(`[${TAG}] editor chaser matched by position name=${CHASER_EDITOR_UNIT_NAME} candidates=${candidates.length} distance=${bestDistance}`)
    return bestUnit
  }
  print(`[${TAG}] editor chaser missing name=${CHASER_EDITOR_UNIT_NAME} candidates=${candidates.length} best_distance=${bestDistance}`)
  return null
}

function queryEditorChaser(startPos: Position2): unknown {
  const fallback = { x: startPos.x, y: CHASER_SPAWN_Y, z: startPos.z }
  const byName = queryEditorUnit(CHASER_EDITOR_UNIT_NAME)
  if (byName !== null && byName !== undefined) {
    return byName
  }
  return queryEditorChaserByPosition(fallback)
}

function setChaserPosition(pos: Position2): void {
  if (chaserUnit === null || chaserUnit === undefined) {
    return
  }
  chaserPosition = pos
  chaserCenterY = CHASER_SPAWN_Y
  safeCall(
    () => {
      ;(chaserUnit as any).set_position(vec3(pos.x, CHASER_SPAWN_Y, pos.z))
    },
    { tag: "second_chaser_set_position", fallback: undefined, logger: print }
  )
  if (chaserTrigger !== null && chaserTrigger !== undefined) {
    safeCall(
      () => {
        ;(chaserTrigger as any).set_position(vec3(pos.x, CHASER_SPAWN_Y, pos.z))
      },
      { tag: "second_chaser_set_trigger_position", fallback: undefined, logger: print }
    )
  }
}

function moveDeathTriggerTo(pos: Position3): void {
  if (chaserTrigger !== null && chaserTrigger !== undefined) {
    safeCall(
      () => {
        ;(chaserTrigger as any).set_position(vec3(pos.x, pos.y, pos.z))
      },
      { tag: "second_chaser_set_trigger_position", fallback: undefined, logger: print }
    )
  }
}

function resetChaserOnFloor(pos: Position2, source: string): void {
  stopChaserPhysics()
  setChaserPosition(pos)
  stopChaserPhysics()
  lockedTarget = undefined
  targetLockTicksLeft = 0
  print(`[${TAG}] reset_on_floor source=${source} pos=(${pos.x},${CHASER_SPAWN_Y},${pos.z}) floor_top_y=${CHASER_FLOOR_TOP_Y}`)
}

function updateChaserPosition(): Position2 | undefined {
  if (chaserUnit !== null && chaserUnit !== undefined) {
    const pos = safeCall(
      () => {
        return (chaserUnit as any).get_position()
      },
      { tag: "second_chaser_get_position", fallback: null, logger: print }
    )
    if (pos !== null && pos !== undefined) {
      chaserPosition = { x: (pos as any).x as number, z: (pos as any).z as number }
      chaserCenterY = (pos as any).y as number
      if (chaserCenterY < CHASER_REST_Y - SINK_RESCUE_TOLERANCE) {
        setChaserPosition(chaserPosition)
        stopChaserPhysics()
      } else {
        moveDeathTriggerTo({ x: chaserPosition.x, y: chaserCenterY, z: chaserPosition.z })
      }
    }
  }
  return chaserPosition
}

function readChaserPhysicsFlag(target: any, methodName: string): string {
  if (target[methodName] === undefined || target[methodName] === null) {
    return "missing"
  }
  const value = safeCall(
    () => {
      return target[methodName]()
    },
    { tag: `second_chaser_${methodName}`, fallback: null, logger: print }
  )
  if (value === null || value === undefined) {
    return "nil"
  }
  return tostring(value)
}

function readChaserRigidBodyType(target: any): string {
  if (target.get_rigid_body_type === undefined || target.get_rigid_body_type === null) {
    return "missing"
  }
  const value = safeCall(
    () => {
      return target.get_rigid_body_type()
    },
    { tag: "second_chaser_get_rigid_body_type", fallback: null, logger: print }
  )
  if (value === null || value === undefined) {
    return "nil"
  }
  return tostring(value)
}

function setChaserFixedAttr(target: any, key: string, value: number, tag: string): boolean {
  if (target.set_attr_by_type === undefined || target.set_attr_by_type === null) {
    return false
  }
  const applied = safeCall(
    () => {
      target.set_attr_by_type(Enums.ValueType.Fixed, key, asFixed(value))
      return true
    },
    { tag, fallback: false, logger: print }
  )
  return applied === true
}

function configureChaserPhysicalMaterial(target: any): void {
  const frictionApplied = setChaserFixedAttr(
    target,
    "FrictionCoefficient",
    CHASER_FRICTION_COEFFICIENT,
    "second_chaser_set_friction"
  )
  const rollingApplied = setChaserFixedAttr(
    target,
    "RollingResistance",
    CHASER_ROLLING_RESISTANCE,
    "second_chaser_set_rolling_resistance"
  )
  const bounceApplied = setChaserFixedAttr(target, "Bounciness", CHASER_BOUNCINESS, "second_chaser_set_bounciness")
  print(
    `[${TAG}] physical_material friction=${CHASER_FRICTION_COEFFICIENT} rolling=${CHASER_ROLLING_RESISTANCE} bounce=${CHASER_BOUNCINESS} runtime_attr=${frictionApplied && rollingApplied && bounceApplied}`
  )
}

function configureChaserPhysics(unit: unknown): void {
  const target = unit as any
  configureChaserPhysicalMaterial(target)
  if (target.set_rigid_body_type !== undefined && target.set_rigid_body_type !== null) {
    safeCall(
      () => {
        target.set_rigid_body_type(Enums.RigidBodyType.DYNAMIC)
      },
      { tag: "second_chaser_set_rigid_body_dynamic", fallback: undefined, logger: print }
    )
  }
  if (target.enable_physics !== undefined && target.enable_physics !== null) {
    safeCall(
      () => {
        target.enable_physics(true)
      },
      { tag: "second_chaser_enable_physics", fallback: undefined, logger: print }
    )
  }
  if (target.set_physics_active !== undefined && target.set_physics_active !== null) {
    safeCall(
      () => {
        target.set_physics_active(true)
      },
      { tag: "second_chaser_set_physics_active", fallback: undefined, logger: print }
    )
  } else if (target.set_physic_enable !== undefined && target.set_physic_enable !== null) {
    safeCall(
      () => {
        target.set_physic_enable(true)
      },
      { tag: "second_chaser_set_physic_enable", fallback: undefined, logger: print }
    )
  } else {
    print(`[${TAG}] physics_switch_unavailable method=set_physics_active prefab=${CHASER_PREFAB_ID}`)
  }
  if (target.enable_collision !== undefined) {
    safeCall(
      () => {
        target.enable_collision(true)
      },
      { tag: "second_chaser_enable_collision", fallback: undefined, logger: print }
    )
  }
  if (target.enable_gravity !== undefined && target.enable_gravity !== null) {
    safeCall(
      () => {
        target.enable_gravity()
      },
      { tag: "second_chaser_enable_gravity", fallback: undefined, logger: print }
    )
  }
  if (target.set_current_mass !== undefined && target.set_current_mass !== null) {
    safeCall(
      () => {
        target.set_current_mass(asFixed(CHASER_MASS))
      },
      { tag: "second_chaser_set_mass", fallback: undefined, logger: print }
    )
  }
  if (target.set_max_linear_velocity !== undefined && target.set_max_linear_velocity !== null) {
    safeCall(
      () => {
        target.set_max_linear_velocity(asFixed(CHASE_SPEED))
      },
      { tag: "second_chaser_set_max_linear_velocity", fallback: undefined, logger: print }
    )
  }
  const isPhysicsActive = readChaserPhysicsFlag(target, "is_physics_active") === "true"
  const isDynamic = readChaserPhysicsFlag(target, "is_dynamic_body") === "true"
  const rigidBodyType = readChaserRigidBodyType(target)
  chaserVelocityControlEnabled =
    isPhysicsActive &&
    target.set_linear_velocity !== undefined &&
    target.set_linear_velocity !== null
  chaserAngularVelocityControlEnabled =
    isPhysicsActive &&
    target.set_angular_velocity !== undefined &&
    target.set_angular_velocity !== null
  chaserForceDriveEnabled =
    isPhysicsActive &&
    isDynamic &&
    target.apply_force !== undefined &&
    target.apply_force !== null
  chaserPointForceDriveEnabled =
    isPhysicsActive &&
    isDynamic &&
    target.apply_force_at_world_point !== undefined &&
    target.apply_force_at_world_point !== null
  print(
    `[${TAG}] movement_config editor_unit=${CHASER_EDITOR_UNIT_NAME} prefab=${CHASER_PREFAB_ID} active=${isPhysicsActive} dynamic=${isDynamic} rigid_type=${rigidBodyType} speed=${CHASE_SPEED} target_lock_ticks=${TARGET_LOCK_TICKS} drive=point_push_roll point_force=${chaserPointForceDriveEnabled} force_drive=${chaserForceDriveEnabled} angular_assist=${chaserAngularVelocityControlEnabled} push_point_height=${CHASER_PUSH_POINT_HEIGHT}`
  )
}

function stopChaserPhysics(): void {
  if (chaserUnit === null || chaserUnit === undefined) {
    return
  }
  if (!chaserVelocityControlEnabled) {
    return
  }
  safeCall(
    () => {
      ;(chaserUnit as any).set_linear_velocity(vec3(0, 0, 0))
    },
    { tag: "second_chaser_stop_linear_velocity", fallback: undefined, logger: print }
  )
  if (chaserAngularVelocityControlEnabled) {
    safeCall(
      () => {
        ;(chaserUnit as any).set_angular_velocity(vec3(0, 0, 0))
      },
      { tag: "second_chaser_stop_angular_velocity", fallback: undefined, logger: print }
    )
  }
}

function getChaserVelocity(): { vx: number; vy: number; vz: number } | undefined {
  if (chaserUnit === null || chaserUnit === undefined || !chaserVelocityControlEnabled) {
    return undefined
  }
  const velocity = safeCall(
    () => {
      return (chaserUnit as any).get_linear_velocity()
    },
    { tag: "second_chaser_get_linear_velocity", fallback: null, logger: print }
  )
  if (velocity === null || velocity === undefined) {
    return undefined
  }
  return {
    vx: (velocity as any).x as number,
    vy: (velocity as any).y as number,
    vz: (velocity as any).z as number,
  }
}

function applyRollingAngularVelocity(vx: number, vz: number): void {
  if (chaserUnit === null || chaserUnit === undefined || !chaserAngularVelocityControlEnabled) {
    return
  }
  const horizontalSpeed = horizontalLength(vx, vz)
  if (horizontalSpeed <= 0.05) {
    return
  }
  const limitedSpeed = math.min(horizontalSpeed, MAX_ROLL_ANGULAR_SPEED * ROLL_RADIUS)
  const scale = (limitedSpeed / horizontalSpeed) * ROLL_ANGULAR_ASSIST / ROLL_RADIUS
  const angularX = vz * scale
  const angularZ = -vx * scale
  safeCall(
    () => {
      ;(chaserUnit as any).set_angular_velocity(vec3(angularX, 0, angularZ))
    },
    { tag: "second_chaser_set_roll_angular_velocity", fallback: undefined, logger: print }
  )
}

function pushChaserAtRollingPoint(dirX: number, dirZ: number): void {
  if (chaserUnit === null || chaserUnit === undefined) {
    return
  }
  const force = vec3(dirX * CHASER_PUSH_FORCE, 0, dirZ * CHASER_PUSH_FORCE)
  if (chaserPointForceDriveEnabled) {
    safeCall(
      () => {
        ;(chaserUnit as any).apply_force_at_world_point(
          force,
          vec3(chaserPosition === undefined ? 0 : chaserPosition.x, chaserCenterY + CHASER_PUSH_POINT_HEIGHT, chaserPosition === undefined ? 0 : chaserPosition.z)
        )
      },
      { tag: "second_chaser_apply_point_force", fallback: undefined, logger: print }
    )
    return
  }
  if (chaserForceDriveEnabled) {
    safeCall(
      () => {
        ;(chaserUnit as any).apply_force(force)
      },
      { tag: "second_chaser_apply_force", fallback: undefined, logger: print }
    )
  }
}

function debugRollSample(vx: number, vz: number): void {
  if (chaserUnit === null || chaserUnit === undefined || rollDebugSamples >= ROLL_DEBUG_SAMPLE_LIMIT) {
    return
  }
  rollDebugSamples += 1
  const angular = safeCall(
    () => {
      return (chaserUnit as any).get_angular_velocity()
    },
    { tag: "second_chaser_get_angular_velocity_debug", fallback: null, logger: print }
  ) as { x?: number; y?: number; z?: number } | null
  print(
    `[${TAG}] roll_sample index=${rollDebugSamples} pos=(${chaserPosition === undefined ? "nil" : chaserPosition.x},${chaserCenterY},${chaserPosition === undefined ? "nil" : chaserPosition.z}) linear=(${vx},${vz}) angular=(${angular?.x === undefined ? "nil" : angular.x},${angular?.y === undefined ? "nil" : angular.y},${angular?.z === undefined ? "nil" : angular.z})`
  )
}

function driveChaserToward(current: Position2, target: Position2, allowedRect: Rect): void {
  if (chaserUnit === null || chaserUnit === undefined) {
    return
  }
  if (!isInsideRect(current, allowedRect)) {
    const clamped = clampToRect(current, allowedRect)
    setChaserPosition(clamped)
    stopChaserPhysics()
    return
  }

  const clampedTarget = clampToRect(target, allowedRect)
  const dx = clampedTarget.x - current.x
  const dz = clampedTarget.z - current.z
  const distance = math.sqrt(dx * dx + dz * dz)
  if (distance <= STOP_DISTANCE) {
    stopChaserPhysics()
    return
  }

  const dirX = dx / distance
  const dirZ = dz / distance
  const horizontalVelocity = vec3(dirX * CHASE_SPEED, 0, dirZ * CHASE_SPEED)
  if (chaserPointForceDriveEnabled || chaserForceDriveEnabled) {
    pushChaserAtRollingPoint(dirX, dirZ)
  } else if (chaserVelocityControlEnabled) {
    safeCall(
      () => {
        ;(chaserUnit as any).set_linear_velocity(horizontalVelocity)
      },
      { tag: "second_chaser_set_linear_velocity_fallback", fallback: undefined, logger: print }
    )
  } else {
    const step = math.min(CHASE_SPEED * TICK_SECONDS, distance)
    setChaserPosition(clampToRect({ x: current.x + dirX * step, z: current.z + dirZ * step }, allowedRect))
    return
  }
  if (chaserVelocityControlEnabled) {
    const velocity = getChaserVelocity()
    if (velocity !== undefined) {
      const horizontalSpeed = horizontalLength(velocity.vx, velocity.vz)
      if (horizontalSpeed > MAX_HORIZONTAL_SPEED) {
        safeCall(
          () => {
            ;(chaserUnit as any).set_linear_velocity(horizontalVelocity)
          },
          { tag: "second_chaser_clamp_linear_velocity", fallback: undefined, logger: print }
        )
        applyRollingAngularVelocity(dirX * CHASE_SPEED, dirZ * CHASE_SPEED)
      } else {
        applyRollingAngularVelocity(velocity.vx, velocity.vz)
      }
      debugRollSample(velocity.vx, velocity.vz)
    }
  }
}

function updateLockedTarget(current: Position2): Position2 | undefined {
  if (targetLockTicksLeft > 0) {
    targetLockTicksLeft -= 1
    return lockedTarget
  }
  targetLockTicksLeft = TARGET_LOCK_TICKS
  const nearest = findNearestRole(current)
  if (nearest !== undefined && nearest.distanceSq <= CHASE_RADIUS * CHASE_RADIUS) {
    activeRoleKey = nearest.key
    lockedTarget = nearest.pos
  } else {
    lockedTarget = undefined
  }
  return lockedTarget
}

function eliminateRolesOverlappedByChaser(center: Position2): void {
  const roles = getOnlineRoles()
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]!
    const pos = getRolePosition(role)
    if (pos === undefined) {
      continue
    }
    const dx = pos.x - center.x
    const dz = pos.z - center.z
    const distanceSq = dx * dx + dz * dz
    if (distanceSq <= DEATH_HIT_RADIUS * DEATH_HIT_RADIUS) {
      const unit = getRoleUnit(role)
      eliminateUnitAndRebirthAtBirth(unit, `second_chaser_overlap:${roleKey(role)}`)
      print(
        `[${TAG}] overlap_death role=${roleKey(role)} role_pos=(${pos.x},${pos.z}) chaser_pos=(${center.x},${chaserCenterY},${center.z}) radius=${DEATH_HIT_RADIUS}`
      )
    }
  }
}

function extractTriggerUnit(data: unknown): unknown {
  const eventData = data as { event_unit?: unknown; unit?: unknown } | undefined
  return eventData?.event_unit !== undefined ? eventData.event_unit : eventData?.unit
}

function registerChaserDeathTrigger(trigger: unknown): void {
  if (trigger === null || trigger === undefined) {
    print(`[${TAG}] death trigger skipped trigger=nil`)
    return
  }
  const triggerId = safeCall(
    () => {
      return (trigger as any).get_id()
    },
    { tag: "second_chaser_death_trigger_id", fallback: null, logger: print }
  )
  if (triggerId === null || triggerId === undefined) {
    print(`[${TAG}] death trigger skipped id=nil`)
    return
  }
  TriggerHub.register(
    [EVENT.ANY_LIFEENTITY_TRIGGER_SPACE, Enums.TriggerSpaceEventType.ENTER, triggerId],
    (_eventName: unknown, _actor: unknown, data: unknown) => {
      eliminateUnitAndRebirthAtBirth(extractTriggerUnit(data), `second_chaser:${tostring(triggerId)}`)
    },
    {
      safe: true,
      safeCallback: true,
      tag: "second_chaser_death",
      logger: print,
    }
  )
  print(`[${TAG}] death trigger registered id=${tostring(triggerId)} prefab=${DEATH_TRIGGER_PREFAB_ID}`)
}

function tick(generation: number): void {
  if (!started || generation !== tickGeneration || stopped || chaserPosition === undefined) {
    return
  }
  debugTickCount += 1
  const currentPosition = updateChaserPosition()
  if (currentPosition === undefined) {
    return
  }
  eliminateRolesOverlappedByChaser(currentPosition)

  const aPlatform = localRectToWorld(
    EXIT_A_PLATFORM.startX,
    EXIT_A_PLATFORM.startZ,
    EXIT_A_PLATFORM.sx,
    EXIT_A_PLATFORM.sz,
    0
  )
  const activeRoleOnA = findActiveRoleOnAPlatform(aPlatform)
  if (activeRoleOnA !== undefined) {
    stopped = true
    stopChaserPhysics()
    print(
      `[${TAG}] stopped player_on_a_platform role=${activeRoleOnA.key} role_pos=(${activeRoleOnA.pos.x},${activeRoleOnA.pos.z}) chaser_pos=(${currentPosition.x},${chaserCenterY},${currentPosition.z})`
    )
    return
  }

  const allowedRect = localRectToWorld(
    MIDDLE_PLATFORM.startX,
    MIDDLE_PLATFORM.startZ,
    MIDDLE_PLATFORM.sx,
    MIDDLE_PLATFORM.sz,
    CHASER_SIZE / 2
  )
  const target = updateLockedTarget(currentPosition)
  if (target !== undefined) {
    driveChaserToward(currentPosition, target, allowedRect)
    if (chaserPosition !== undefined) {
      eliminateRolesOverlappedByChaser(chaserPosition)
    }
  } else {
    stopChaserPhysics()
  }

  ;(LuaAPI as any).call_delay_time(asFixed(TICK_SECONDS), () => tick(generation))
}

export function startSecondLevelChaser(): void {
  if (started) {
    return
  }
  started = true
  stopped = false
  activeRoleKey = undefined
  lockedTarget = undefined
  targetLockTicksLeft = 0
  rollDebugSamples = 0
  chaserTrigger = undefined
  chaserCenterY = CHASER_SPAWN_Y
  tickGeneration += 1

  const allowedRect = localRectToWorld(
    MIDDLE_PLATFORM.startX,
    MIDDLE_PLATFORM.startZ,
    MIDDLE_PLATFORM.sx,
    MIDDLE_PLATFORM.sz,
    CHASER_SIZE / 2
  )
  const startPos = clampToRect(localPointToWorld(SPHERE_MARK_LOCAL_X, SPHERE_MARK_LOCAL_Z), allowedRect)
  chaserPosition = startPos
  chaserUnit = queryEditorChaser(startPos)
  if (chaserUnit === null || chaserUnit === undefined) {
    print(
      `[${TAG}] editor chaser not found name=${CHASER_EDITOR_UNIT_NAME} prefab=${CHASER_PREFAB_ID} expected_pos=(${startPos.x},${CHASER_SPAWN_Y},${startPos.z}); place this prefab in editor scene`
    )
    started = false
    chaserPosition = undefined
    return
  }
  setChaserPosition(startPos)
  configureChaserPhysics(chaserUnit)
  chaserTrigger = safeCreateCustomTriggerSpace(
    DEATH_TRIGGER_PREFAB_ID,
    vec3(startPos.x, CHASER_SPAWN_Y, startPos.z),
    vec3(DEATH_TRIGGER_SIZE, DEATH_TRIGGER_SIZE, DEATH_TRIGGER_SIZE),
    { tag: "second_chaser_death_trigger_create", logger: print }
  )
  registerChaserDeathTrigger(chaserTrigger)

  print(
    `[${TAG}] start editor_unit=${CHASER_EDITOR_UNIT_NAME} prefab=${CHASER_PREFAB_ID} pos=(${startPos.x},${CHASER_SPAWN_Y},${startPos.z}) floor_top_y=${CHASER_FLOOR_TOP_Y} radius=${CHASE_RADIUS} speed=${CHASE_SPEED} trigger_prefab=${DEATH_TRIGGER_PREFAB_ID} mode=point_force_roll`
  )
  tick(tickGeneration)
}

function resetSecondChaserToInitial(source: string): void {
  if (!started) {
    return
  }
  const allowedRect = localRectToWorld(
    MIDDLE_PLATFORM.startX,
    MIDDLE_PLATFORM.startZ,
    MIDDLE_PLATFORM.sx,
    MIDDLE_PLATFORM.sz,
    CHASER_SIZE / 2
  )
  const startPos = clampToRect(localPointToWorld(SPHERE_MARK_LOCAL_X, SPHERE_MARK_LOCAL_Z), allowedRect)
  stopped = false
  activeRoleKey = undefined
  lockedTarget = undefined
  targetLockTicksLeft = 0
  rollDebugSamples = 0
  tickGeneration += 1
  resetChaserOnFloor(startPos, `reset_${source}`)
  print(`[${TAG}] reset_to_initial source=${source} pos=(${startPos.x},${CHASER_SPAWN_Y},${startPos.z})`)
  tick(tickGeneration)
}

EventBus.on(GAME_EVENTS.PLAYER_DIED_TO_REBIRTH, (_unit: unknown, source: unknown) => {
  resetSecondChaserToInitial(tostring(source))
})
