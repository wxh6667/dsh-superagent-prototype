/** Caps shared by swarm creation, local dispatch and worker launches. */
export const SWARM_LIMITS = {
  /** Bounds of the active-swarm cap itself; `MAX_ACTIVE_SWARMS` is the enforced value. */
  maxActive: { min: 2, max: 16, default: 4 },
  maxTasks: { min: 1, max: 100 },
  maxWorkers: { min: 1, max: 16 },
  maxRounds: { min: 1, max: 20 },
} as const
/** The enforced cap on simultaneously active swarms. */
export const MAX_ACTIVE_SWARMS = SWARM_LIMITS.maxActive.default

/** Validation bounds shared between host schemas and management panel forms. */
export const LIMITS = {
  ruleName: 100,
  ruleInstruction: 2000,
  evalTimeoutSeconds: { min: 30, max: 600 },
  maxWorkers: { min: 1, max: 16 },
  prepareCommand: 4000,
  promptMaxChars: { min: 1000, max: 1_000_000 },
  admissionContextMaxPages: { min: 1, max: 100 },
  admissionContextTimeoutMs: { min: 1, max: 90_000 },
  swarm: {
    title: 200,
    mission: 20_000,
    acceptance: 4_000,
    scope: 2_000,
    verify: 1_000,
    maxActive: SWARM_LIMITS.maxActive,
    maxTasks: SWARM_LIMITS.maxTasks,
    maxWorkers: SWARM_LIMITS.maxWorkers,
    maxRounds: SWARM_LIMITS.maxRounds,
  },
} as const
