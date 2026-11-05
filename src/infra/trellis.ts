/** Thin adapter around a target repository's Trellis task script. */
import { execFile, execFileSync } from 'node:child_process'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** One Trellis task to create: its title, description and plan artifacts. */
export interface TrellisTaskPlan {
  title: string
  description: string
  prd: string
  design?: string
  implement?: string
}

export interface TrellisPlanResult {
  parent: { dir: string; title: string }
  children: { dir: string; title: string }[]
}

/** Runs `python3 <task.py> ...`; tests inject a fake runner. */
export type TrellisRunner = (argv: string[], cwd: string, env: Record<string, string | undefined>) => Promise<string>
/** Synchronous runner for the commit guard, which cannot await. */
export type TrellisSyncRunner = (argv: string[], cwd: string, env: Record<string, string | undefined>) => string

export interface TrellisHost {
  /** The configured local repository, or empty while setup has not resolved it. */
  repository: () => string
  /** The main Session id, passed to `task.py` as `DSH_SESSION_ID` so its session-scoped active task is the main Session's. */
  sessionId: string
  run?: TrellisRunner
  runSync?: TrellisSyncRunner
}

/**
 * Creates, starts and archives Trellis tasks in a local repository. It never initializes Trellis and never reads credentials;
 * callers must have confirmed the plan before creating tasks.
 */
export class Trellis {
  constructor(private readonly host: TrellisHost) {}

  /** Create a parent and its children, write their plan artifacts, and start the parent as the main Session's active task. */
  async plan(input: { parent: TrellisTaskPlan; children: TrellisTaskPlan[] }): Promise<TrellisPlanResult> {
    const repo = await this.root()
    const parent = await this.create(repo, input.parent)
    const children: { dir: string; title: string }[] = []
    for (const child of input.children) {
      const created = await this.create(repo, child, parent)
      children.push({ dir: created, title: child.title })
    }
    await this.start(parent)
    return { parent: { dir: parent, title: input.parent.title }, children }
  }

  /** Start a task for the main Session; this sets the session-scoped Trellis active task. */
  async start(taskDir: string): Promise<void> {
    const repo = await this.root()
    await this.run(repo, ['start', '--allow-empty-context', this.taskRef(repo, taskDir)])
  }

  /** Archive a completed task. Trellis' own archive commit is left intact. */
  async archive(taskDir: string): Promise<void> {
    const repo = await this.root()
    await this.run(repo, ['archive', '--skip-branch-validation', this.taskRef(repo, taskDir)])
  }

  /** The main Session's current Trellis task, if any. */
  async current(): Promise<{ dir: string; status: string } | undefined> {
    const repo = await this.root()
    let output = ''
    try { output = await this.run(repo, ['current', '--json']) }
    catch (error) { output = (error as { stdout?: string }).stdout ?? '' }
    return parseCurrent(output)
  }

  /** Synchronous form for the commit guard. */
  currentSync(): { dir: string; status: string } | undefined {
    const repo = this.rootSync()
    let output = ''
    try { output = this.runSync(repo, ['current', '--json']) }
    catch (error) { output = String((error as { stdout?: string }).stdout ?? '') }
    return parseCurrent(output)
  }

  private async root(): Promise<string> {
    const repo = this.host.repository()
    if (!repo) throw new Error('The local Source is not configured; set its repository in Settings and enable it')
    const script = join(repo, '.trellis', 'scripts', 'task.py')
    try { await stat(script) } catch { throw new Error(`The local repository has no Trellis task script: ${script}`) }
    try { await stat(join(repo, '.trellis', '.developer')) } catch { throw new Error(`The local repository has no Trellis developer identity: ${join(repo, '.trellis', '.developer')}`) }
    return repo
  }

  private rootSync(): string {
    const repo = this.host.repository()
    if (!repo) throw new Error('The local Source is not configured; set its repository in Settings and enable it')
    const script = join(repo, '.trellis', 'scripts', 'task.py')
    try { statSync(script) } catch { throw new Error(`The local repository has no Trellis task script: ${script}`) }
    try { statSync(join(repo, '.trellis', '.developer')) } catch { throw new Error(`The local repository has no Trellis developer identity: ${join(repo, '.trellis', '.developer')}`) }
    return repo
  }

  private async create(repo: string, plan: TrellisTaskPlan, parent?: string): Promise<string> {
    const slug = slugify(plan.title)
    const args = ['create', plan.title, '--slug', slug, '--description', plan.description, '--no-start']
    if (parent) args.push('--parent', parent)
    await this.run(repo, args)
    const dir = await this.find(repo, slug)
    await writeFile(join(dir, 'prd.md'), plan.prd)
    if (plan.design !== undefined) await writeFile(join(dir, 'design.md'), plan.design)
    if (plan.implement !== undefined) await writeFile(join(dir, 'implement.md'), plan.implement)
    return dir
  }

  private async find(repo: string, slug: string): Promise<string> {
    const tasks = join(repo, '.trellis', 'tasks')
    const entries = await readdir(tasks, { withFileTypes: true })
    const match = entries.filter(entry => entry.isDirectory() && entry.name.endsWith(`-${slug}`)).map(entry => entry.name).sort().at(-1)
    if (!match) throw new Error(`Trellis created no task directory ending in -${slug}`)
    return join(tasks, match)
  }

  private taskRef(repo: string, taskDir: string): string {
    const tasks = resolve(repo, '.trellis', 'tasks')
    const target = resolve(taskDir)
    if (!target.startsWith(tasks + sep)) throw new Error(`Not a task directory under ${tasks}: ${taskDir}`)
    return relative(repo, target)
  }

  private async run(repo: string, args: string[]): Promise<string> {
    const script = join(repo, '.trellis', 'scripts', 'task.py')
    const env = { ...process.env, DSH_SESSION_ID: this.host.sessionId }
    if (this.host.run) return this.host.run(['python3', script, ...args], repo, env)
    const { stdout } = await exec('python3', [script, ...args], { cwd: repo, env, maxBuffer: 1 << 20 })
    return stdout
  }

  private runSync(repo: string, args: string[]): string {
    const script = join(repo, '.trellis', 'scripts', 'task.py')
    const env = { ...process.env, DSH_SESSION_ID: this.host.sessionId }
    if (this.host.runSync) return this.host.runSync(['python3', script, ...args], repo, env)
    return execFileSync('python3', [script, ...args], { cwd: repo, env, encoding: 'utf8' })
  }
}

function parseCurrent(output: string): { dir: string; status: string } | undefined {
  try {
    const data = JSON.parse(output) as { current_task?: { dir?: string; status?: string } | null }
    return data.current_task?.dir ? { dir: data.current_task.dir, status: data.current_task.status ?? '' } : undefined
  } catch { return undefined }
}

/**
 * The main-Session commit gate: a `git commit` needs an in-progress Trellis task. `WXH_TRELLIS_BYPASS=1` is the explicit
 * bypass. Non-commit commands pass through.
 */
export function trellisCommitGuard(command: string, current: { dir: string; status: string } | undefined): string | undefined {
  if (!/\bgit\b[^\n;&|]*\bcommit\b/.test(command)) return undefined
  if (/\bWXH_TRELLIS_BYPASS=1\b/.test(command)) return undefined
  if (!current) return 'No active Trellis task; start one before committing, or prefix WXH_TRELLIS_BYPASS=1 for an explicit bypass'
  if (current.status !== 'in_progress') return `Trellis task ${current.dir} is ${current.status}; start it before committing`
  return undefined
}

/** A task slug safe for `task.py --slug` and a directory name. */
export function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return slug || 'task'
}
