/** Swarm launcher: a goal and a workspace up front, the rest of the brief under Advanced, and the active and completed swarms. */
import { useEffect, useState } from 'react'
import type { ApiResponse } from '../app/api.ts'
import type { SwarmModel } from '../core/index.ts'
import { LIMITS } from '../limits.ts'
import { usePoll, type SwarmView } from './api.ts'
import { Button, DisclosureRow, Dot, Icon, Input, Tag } from './controls.tsx'
import { useAction, usePanel } from './provider.tsx'
import { Field, Fields, numberOf } from './settings-kit.tsx'
import { errorText } from './text.ts'
import { ConfirmButton, Hint, LoadState, Section, When } from './widgets.tsx'

interface Draft {
  mission: string
  workspace: string
  /** True while the person types a path instead of choosing a registered workspace. */
  manual: boolean
  title: string
  /** True once the person edits the title, so the mission no longer derives it. */
  titleEdited: boolean
  advanced: boolean
  acceptance: string
  scope: string
  verify: string
  prepare: string
  /** The main-Session model the swarm pins, as a dropdown value; empty inherits the global setting. */
  masterModel: string
  /** The worker model the swarm pins, as a dropdown value; empty inherits the global setting. */
  workerModel: string
  maxTasks: string
  maxWorkers: string
  maxRounds: string
}
/** Defaults offered by the form; they match the SwarmManager's budget defaults. */
const INITIAL: Draft = { mission: '', workspace: '', manual: false, title: '', titleEdited: false, advanced: false,
  acceptance: '', scope: '', verify: 'scripts/verify.sh', prepare: '', masterModel: '', workerModel: '',
  maxTasks: '20', maxWorkers: '2', maxRounds: '3' }

/** One model dropdown value: a JSON pair of provider and model id, or empty for inheriting the global setting. */
const modelValue = (provider: string, model: string): string => JSON.stringify([provider, model])
/**
 * The model a dropdown value names: `undefined` for inherit, or `false` for a value this page did not write. A pin is never
 * saved from an unreadable value, so a stale or edited form cannot silently record an empty model.
 */
export function modelOf(value: string): SwarmModel | undefined | false {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && parsed[0]
      && typeof parsed[1] === 'string' && parsed[1]) return { provider: parsed[0], model: parsed[1] }
  } catch { /* Not a value this page wrote. */ }
  return false
}

/** The title a mission derives: its first non-empty line, truncated to the stored limit. */
export function titleOf(mission: string): string {
  return (mission.split('\n').map(line => line.trim()).find(Boolean) ?? '').slice(0, LIMITS.swarm.title)
}

/** One model dropdown of the launcher: "inherit" first, then every provider and its available models. */
function ModelSelect({ label, value, groups, onChange }: {
  label: string; value: string; onChange: (next: string) => void
  groups: readonly { id: string; name: string; models: readonly { id: string; name: string }[] }[]
}) {
  const { t } = usePanel()
  return <Field label={label} hint={t('swarmModelHint')}>
    <select className="dt-select" value={value} onChange={event => onChange(event.target.value)}>
      <option value="">{t('swarmModelInherit')}</option>
      {groups.map(group => <optgroup key={group.id} label={group.name}>
        {group.models.map(model => <option key={model.id} value={modelValue(group.id, model.id)}>{model.name}</option>)}
      </optgroup>)}
    </select>
  </Field>
}

function SwarmRow({ swarm, onOpen, onFinish, busy }: {
  swarm: SwarmView; onOpen: (swarm: SwarmView) => void; onFinish: (swarm: SwarmView) => Promise<unknown>; busy: boolean
}) {
  const { t } = usePanel()
  const active = swarm.status === 'active' && !swarm.legacy
  const pinned = (model: SwarmModel | undefined) => model
    ? <span className="dt-mono">{`${model.provider} / ${model.model}`}</span> : t('swarmModelInherit')
  return <li className="dt-row">
    <Dot state={swarm.legacy ? 'idle' : active ? 'ongoing' : 'done'} />
    <div className="dt-row-main">
      <div className="dt-row-title">
        <span className="dt-row-name">{swarm.title}</span>
        <Tag tone={swarm.legacy ? 'quiet' : active ? 'info' : 'neutral'}>{swarm.legacy ? t('swarmLegacy')
          : active ? t('swarmActive') : t('swarmCompleted')}</Tag>
        {swarm.legacy && <Tag tone="outline" title={t('swarmLegacyHint')}>{t('swarmReadOnly')}</Tag>}
      </div>
      <p className="dt-row-quote" style={{ whiteSpace: 'pre-wrap' }}>{swarm.mission}</p>
      <div className="dt-row-meta">
        <span className="dt-mono" title={swarm.workspace}>{swarm.workspace}</span>
        <span>{t('swarmMaster')}{t('labelSeparator')}<span className="dt-mono">{swarm.masterSessionId || t('empty')}</span></span>
        {!swarm.legacy && <span>{t('swarmBudgetValue', { tasks: swarm.budget.maxTasks, workers: swarm.budget.maxWorkers,
          rounds: swarm.budget.maxRounds })}</span>}
        {!swarm.legacy && <span title={t('swarmModelHint')}>{t('swarmMasterModel')}{t('labelSeparator')}{pinned(swarm.masterModel)}</span>}
        {!swarm.legacy && <span title={t('swarmModelHint')}>{t('swarmWorkerModel')}{t('labelSeparator')}{pinned(swarm.workerModel)}</span>}
        <span>{t('swarmCreated')} <When at={swarm.createdAt} /></span>
        {swarm.completedAt && <span><When at={swarm.completedAt} /></span>}
      </div>
      {active && <div className="dt-row-buttons">
        <Button variant="outline" size="sm" icon={<Icon name="session" size={14} />} disabled={busy}
          onClick={() => onOpen(swarm)}>{t('swarmOpen')}</Button>
        <ConfirmButton variant="outline" icon="stop" label={t('swarmFinish')} title={t('swarmFinishTitle')}
          message={t('swarmFinishConfirm', { title: swarm.title })} onConfirm={() => onFinish(swarm)} />
      </div>}
    </div>
  </li>
}

export function SwarmsPage() {
  const { t, call, openSession } = usePanel()
  const { data, error, reload } = usePoll(() => call('GET swarms'), [call])
  const [draft, setDraft] = useState(INITIAL)
  // The launcher's model choices come from the host's catalog; a failure says so instead of hiding the dropdowns.
  const [catalog, setCatalog] = useState<{ models?: ApiResponse<'GET models'>; error?: string }>({})
  useEffect(() => {
    let live = true
    call('GET models').then(value => { if (live) setCatalog({ models: value }) },
      failure => { if (live) setCatalog({ error: errorText(failure) }) })
    return () => { live = false }
  }, [call])
  const groups = catalog.models?.groups.filter(group => group.models.length > 0) ?? []
  const catalogNote = catalog.error ? t('swarmModelCatalogUnavailable', { error: catalog.error })
    : catalog.models && groups.length === 0 ? t('swarmModelCatalogEmpty') : undefined
  const fallback = data?.defaultWorkspace ?? ''
  // Pre-fill the workspace once the local Source's repository is known, unless the person already chose one.
  useEffect(() => { if (fallback) setDraft(current => current.workspace ? current : { ...current, workspace: fallback }) }, [fallback])
  const edit = (next: Partial<Draft>) => setDraft(current => ({ ...current, ...next }))
  // Registered long-term workspaces, plus the local Source's repository while it is not registered yet.
  const options: { id: string; path: string; title: string }[] = [...(data?.workspaces ?? [])]
  if (fallback && !options.some(item => item.path === fallback)) options.push({ id: fallback, path: fallback, title: '' })

  const create = useAction(async () => {
    const mission = draft.mission.trim(), workspace = draft.workspace.trim()
    if (!mission) throw new Error(t('swarmMissionRequired'))
    if (!workspace) throw new Error(t('swarmWorkspaceRequired'))
    // A chosen model is saved as chosen; an unreadable value fails loudly rather than being dropped as inherit.
    const masterModel = modelOf(draft.masterModel), workerModel = modelOf(draft.workerModel)
    if (masterModel === false) throw new Error(t('swarmModelInvalid', { field: t('swarmMasterModel') }))
    if (workerModel === false) throw new Error(t('swarmModelInvalid', { field: t('swarmWorkerModel') }))
    const maxTasks = numberOf(draft.maxTasks), maxWorkers = numberOf(draft.maxWorkers), maxRounds = numberOf(draft.maxRounds)
    if (maxTasks === null || maxWorkers === null || maxRounds === null
      || !Number.isInteger(maxTasks) || !Number.isInteger(maxWorkers) || !Number.isInteger(maxRounds)) {
      throw new Error(t('swarmBudgetRequired'))
    }
    const created = await call('POST swarms', { body: {
      title: (draft.titleEdited ? draft.title.trim() : '') || titleOf(mission),
      mission, workspace,
      verify: draft.verify.trim() || 'scripts/verify.sh', prepare: draft.prepare,
      ...draft.acceptance.trim() ? { acceptance: draft.acceptance.trim() } : {},
      ...draft.scope.trim() ? { scope: draft.scope.trim() } : {},
      ...masterModel ? { masterModel } : {},
      ...workerModel ? { workerModel } : {},
      budget: { maxTasks, maxWorkers, maxRounds },
    } })
    const opened = await call('POST swarms/:id/open', { id: created.swarm.id })
    await openSession(opened.masterId)
    setDraft(current => ({ ...INITIAL, workspace: current.workspace, manual: current.manual }))
  }, { reload })
  const open = useAction(async (swarm: SwarmView) => {
    const opened = await call('POST swarms/:id/open', { id: swarm.id })
    await openSession(opened.masterId)
  }, { reload })
  const finish = async (swarm: SwarmView) => { await call('POST swarms/:id/finish', { id: swarm.id }); await reload() }

  const active = data?.items.filter(swarm => swarm.status === 'active' && !swarm.legacy) ?? []
  const completed = data?.items.filter(swarm => swarm.status === 'completed' || swarm.legacy) ?? []
  return <div className="dt-form">
    <Hint>{t('swarmsIntro')}</Hint>
    <LoadState error={error} loading={!data} />
    <Section title={t('swarmNew')} icon="plus">
      <form className="dt-form dt-block" onSubmit={event => { event.preventDefault(); void create.run() }}>
        <Fields disabled={create.busy}>
          <Field label={t('swarmMission')} hint={t('swarmMissionHint')}>
            <textarea className="dt-textarea" rows={4} required maxLength={LIMITS.swarm.mission} value={draft.mission}
              onChange={event => edit({ mission: event.target.value })} />
          </Field>
          <Field label={t('swarmWorkspace')} hint={t('swarmWorkspaceHint')}
            note={!draft.manual && options.length === 0 ? t('swarmWorkspaceNone') : undefined}>
            {draft.manual
              ? <Input required pattern="/.*" className="dt-mono" spellCheck={false} value={draft.workspace}
                  onChange={event => edit({ workspace: event.target.value })} />
              : <select className="dt-select" required value={draft.workspace}
                  onChange={event => edit({ workspace: event.target.value })}>
                  <option value="">{t('swarmWorkspaceChoose')}</option>
                  {options.map(item => <option key={item.id} value={item.path}>
                    {item.title ? `${item.title} — ${item.path}` : item.path}
                  </option>)}
                </select>}
          </Field>
          <div className="dt-actions">
            <Button variant="ghost" size="sm" icon={<Icon name={draft.manual ? 'filter' : 'plus'} size={14} />}
              onClick={() => edit({ manual: !draft.manual })}>
              {draft.manual ? t('swarmWorkspaceList') : t('swarmWorkspaceManual')}
            </Button>
          </div>
          <DisclosureRow icon={<Icon name="settings" size={14} />} title={t('swarmAdvanced')} open={draft.advanced}
            onToggle={() => edit({ advanced: !draft.advanced })}>
            <Field label={t('swarmTitle')} hint={t('swarmTitleAuto', { max: LIMITS.swarm.title })}>
              <Input maxLength={LIMITS.swarm.title} placeholder={titleOf(draft.mission)} value={draft.title}
                onChange={event => edit({ title: event.target.value, titleEdited: true })} />
            </Field>
            <Field label={t('swarmAcceptance')} hint={t('swarmAcceptanceHint')}>
              <textarea className="dt-textarea" rows={2} maxLength={LIMITS.swarm.acceptance} value={draft.acceptance}
                onChange={event => edit({ acceptance: event.target.value })} />
            </Field>
            <Field label={t('swarmScope')} hint={t('swarmScopeHint')}>
              <textarea className="dt-textarea" rows={2} maxLength={LIMITS.swarm.scope} value={draft.scope}
                onChange={event => edit({ scope: event.target.value })} />
            </Field>
            <Field label={t('swarmVerify')} hint={t('swarmVerifyHint')}>
              <Input maxLength={LIMITS.swarm.verify} className="dt-mono" spellCheck={false} value={draft.verify}
                onChange={event => edit({ verify: event.target.value })} />
            </Field>
            <Field label={t('swarmPrepare')} hint={t('swarmPrepareHint')}>
              <textarea className="dt-textarea" rows={2} maxLength={LIMITS.prepareCommand} spellCheck={false} value={draft.prepare}
                onChange={event => edit({ prepare: event.target.value })} />
            </Field>
            <div className="dt-grid3">
              <Field label={t('swarmMaxTasks')}>
                <Input type="number" required step={1} min={LIMITS.swarm.maxTasks.min} max={LIMITS.swarm.maxTasks.max}
                  value={draft.maxTasks} onChange={event => edit({ maxTasks: event.target.value })} />
              </Field>
              <Field label={t('swarmMaxWorkers')}>
                <Input type="number" required step={1} min={LIMITS.swarm.maxWorkers.min} max={LIMITS.swarm.maxWorkers.max}
                  value={draft.maxWorkers} onChange={event => edit({ maxWorkers: event.target.value })} />
              </Field>
              <Field label={t('swarmMaxRounds')}>
                <Input type="number" required step={1} min={LIMITS.swarm.maxRounds.min} max={LIMITS.swarm.maxRounds.max}
                  value={draft.maxRounds} onChange={event => edit({ maxRounds: event.target.value })} />
              </Field>
            </div>
            {catalogNote && <Hint>{catalogNote}</Hint>}
            <ModelSelect label={t('swarmMasterModel')} value={draft.masterModel} groups={groups}
              onChange={value => edit({ masterModel: value })} />
            <ModelSelect label={t('swarmWorkerModel')} value={draft.workerModel} groups={groups}
              onChange={value => edit({ workerModel: value })} />
          </DisclosureRow>
        </Fields>
        <div className="dt-actions">
          <Button type="submit" variant="primary" disabled={create.busy} icon={<Icon name="plus" size={14} />}>
            {t('swarmCreate')}
          </Button>
        </div>
      </form>
    </Section>
    {data && <>
      <Section title={t('swarmsActive')} count={active.length}>
        {active.length ? <ul className="dt-list">{active.map(swarm => <SwarmRow key={swarm.id} swarm={swarm} busy={open.busy}
          onOpen={swarm => { void open.run(swarm) }} onFinish={finish} />)}</ul> : <Hint>{t('swarmNoneActive')}</Hint>}
      </Section>
      <Section title={t('swarmsCompleted')} count={completed.length}>
        {completed.length ? <ul className="dt-list">{completed.map(swarm => <SwarmRow key={swarm.id} swarm={swarm} busy={open.busy}
          onOpen={swarm => { void open.run(swarm) }} onFinish={finish} />)}</ul> : <Hint>{t('swarmNoneCompleted')}</Hint>}
      </Section>
    </>}
  </div>
}
