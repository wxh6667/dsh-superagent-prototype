/** Swarm launcher: the brief of a new swarm, active and completed swarms, and their Open and Finish actions. */
import { useEffect, useState } from 'react'
import { LIMITS } from '../limits.ts'
import { usePoll, type SwarmView } from './api.ts'
import { Button, Dot, Icon, Input, Tag } from './controls.tsx'
import { useAction, usePanel } from './provider.tsx'
import { Field, Fields, numberOf } from './settings-kit.tsx'
import { ConfirmButton, Hint, LoadState, Section, When } from './widgets.tsx'

interface Draft {
  title: string
  mission: string
  acceptance: string
  scope: string
  workspace: string
  verify: string
  prepare: string
  maxTasks: string
  maxWorkers: string
  maxRounds: string
}
/** Defaults offered by the form; they match the SwarmManager's budget defaults. */
const INITIAL: Draft = { title: '', mission: '', acceptance: '', scope: '', workspace: '', verify: 'scripts/verify.sh', prepare: '',
  maxTasks: '20', maxWorkers: '2', maxRounds: '3' }

function SwarmRow({ swarm, onOpen, onFinish, busy }: {
  swarm: SwarmView; onOpen: (swarm: SwarmView) => void; onFinish: (swarm: SwarmView) => Promise<unknown>; busy: boolean
}) {
  const { t } = usePanel()
  const active = swarm.status === 'active' && !swarm.legacy
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
  const fallback = data?.defaultWorkspace ?? ''
  // Pre-fill the workspace once the local Source's repository is known, unless the person already typed one.
  useEffect(() => { if (fallback) setDraft(current => current.workspace ? current : { ...current, workspace: fallback }) }, [fallback])
  const edit = (next: Partial<Draft>) => setDraft(current => ({ ...current, ...next }))

  const create = useAction(async () => {
    const maxTasks = numberOf(draft.maxTasks), maxWorkers = numberOf(draft.maxWorkers), maxRounds = numberOf(draft.maxRounds)
    if (maxTasks === null || maxWorkers === null || maxRounds === null
      || !Number.isInteger(maxTasks) || !Number.isInteger(maxWorkers) || !Number.isInteger(maxRounds)) {
      throw new Error(t('swarmBudgetRequired'))
    }
    const created = await call('POST swarms', { body: {
      title: draft.title.trim(), mission: draft.mission.trim(), workspace: draft.workspace.trim(),
      verify: draft.verify.trim() || 'scripts/verify.sh', prepare: draft.prepare,
      ...draft.acceptance.trim() ? { acceptance: draft.acceptance.trim() } : {},
      ...draft.scope.trim() ? { scope: draft.scope.trim() } : {},
      budget: { maxTasks, maxWorkers, maxRounds },
    } })
    const opened = await call('POST swarms/:id/open', { id: created.swarm.id })
    await openSession(opened.masterId)
    setDraft(current => ({ ...INITIAL, workspace: current.workspace }))
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
          <Field label={t('swarmTitle')} hint={t('swarmTitleHint')}>
            <Input required maxLength={LIMITS.swarm.title} value={draft.title}
              onChange={event => edit({ title: event.target.value })} />
          </Field>
          <Field label={t('swarmMission')} hint={t('swarmMissionHint')}>
            <textarea className="dt-textarea" rows={4} required maxLength={LIMITS.swarm.mission} value={draft.mission}
              onChange={event => edit({ mission: event.target.value })} />
          </Field>
          <Field label={t('swarmAcceptance')} hint={t('swarmAcceptanceHint')}>
            <textarea className="dt-textarea" rows={2} maxLength={LIMITS.swarm.acceptance} value={draft.acceptance}
              onChange={event => edit({ acceptance: event.target.value })} />
          </Field>
          <Field label={t('swarmScope')} hint={t('swarmScopeHint')}>
            <textarea className="dt-textarea" rows={2} maxLength={LIMITS.swarm.scope} value={draft.scope}
              onChange={event => edit({ scope: event.target.value })} />
          </Field>
          <Field label={t('swarmWorkspace')} hint={t('swarmWorkspaceHint')}>
            <Input required pattern="/.*" className="dt-mono" spellCheck={false} value={draft.workspace}
              onChange={event => edit({ workspace: event.target.value })} />
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
