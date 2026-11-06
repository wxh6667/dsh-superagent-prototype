/** Structured startup and configuration errors with the settings location where the operator can fix them. */
import { fill } from './infra/text.ts'

export type SetupPlace = 'deployment' | 'local'
export const SETUP_PROBLEMS = {
  foreignFile: ['deployment', '{file} was not written by dsh-superagent; move it, or choose another state directory.'],
  environmentFailed: ['deployment', 'Preparing the agent environment failed.'],
  localRepositoryUnset: ['local', 'The local Source names no repository.'],
  localRepositoryInvalid: ['local', 'The local repository must be an absolute directory: {path}.'],
  localRepositoryMissing: ['local', 'The local repository does not exist: {path}.'],
  localRepositoryNotGit: ['local', 'The local repository is not a git repository: {path}.'],
  localRepositoryNoTrellis: ['local', 'The local repository has no .trellis directory: {path}. Run trellis init there first.'],
  localActorNotAllowed: ['local', 'The local actor {actor} is not in the local Source\'s allowed list.'],
} as const satisfies Record<string, readonly [SetupPlace, string]>
export type SetupCode = keyof typeof SETUP_PROBLEMS
export interface SetupProblem { place: SetupPlace; code: SetupCode; values: Record<string, string>; detail: string }

/**
 * Thrown by deployment verification checks when the local repository is missing or unusable.
 * `Setup` records it for the management overview, and the HTTP layer returns `problem` so the panel can localize it.
 */
export class SetupError extends Error {
  readonly place: SetupPlace
  constructor(readonly code: SetupCode, readonly values: Record<string, string> = {}) {
    const [place, text] = SETUP_PROBLEMS[code]
    const sentence = fill(text, values)
    super(values.output ? `${sentence}\n${values.output}` : sentence)
    this.place = place
  }
  get problem(): SetupProblem { return { place: this.place, code: this.code, values: this.values, detail: this.message } }
}
