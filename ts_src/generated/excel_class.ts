/* AUTO-GENERATED. DO NOT EDIT. */
/* eslint-disable */

export class ExperienceLevelConfig {
  public ["level"]!: number
  public ["exp"]!: number
  public ["exp_display_k"]!: string
  public ["total_exp"]!: number
  public ["total_display_k"]!: string
}

export class SuggestedClearSpeedConfig {
  public ["stage"]!: number
  public ["name"]!: string
  public ["maxSpeed"]!: number
  public ["groundAcceleration"]!: string
  public ["groundDeceleration"]!: string
  public ["airAcceleration"]!: string
  public ["airDeceleration"]!: string
}

export class SpeedStageConfig {
  public ["stage"]!: number
  public ["targetSpeed"]!: number
  public ["targetMinute"]!: number
  public ["dashboardMaxSpeed"]!: string
  public ["groundAcceleration"]!: string
  public ["groundDeceleration"]!: string
  public ["airAcceleration"]!: string
  public ["airDeceleration"]!: string
  public ["note"]!: string
}

export class SpeedBonusSourceConfig {
  public ["id"]!: number
  public ["source"]!: string
  public ["unlockCondition"]!: string
  public ["addSpeed"]!: number
  public ["durationSeconds"]!: number
  public ["temporary"]!: boolean
  public ["stackRule"]!: string
  public ["note"]!: string
}

export class ExperienceSourceConfig {
  public ["id"]!: number
  public ["source"]!: string
  public ["sourceKind"]!: string
  public ["baseExpPerTick"]!: number
  public ["levelExponent"]!: number
  public ["multiplier"]!: number
  public ["unlockCondition"]!: string
  public ["affectedByRebirth"]!: boolean
  public ["stackRule"]!: string
  public ["note"]!: string
}

export class RebirthExpMultiplierConfig {
  public ["rebirthCount"]!: number
  public ["expMultiplier"]!: number
  public ["unlockLevel"]!: number
  public ["resetLevel"]!: number
  public ["note"]!: string
}

export class RebirthCoinMultiplierConfig {
  public ["rebirthCount"]!: number
  public ["coinMultiplier"]!: number
  public ["unlockLevel"]!: number
  public ["note"]!: string
}
