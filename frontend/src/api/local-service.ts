import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ProjectDraft,
  ProjectQuery,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 批复金额单位为万元：负数或超过上限都按无效值退回，不进数据层。
export const PROJECT_AMOUNT_MAX = 100000

// 治理工程批复后，往警示标识台账挂的拨付记录类别与编号前缀。
const DISBURSE_CATEGORY = '治理工程待核拨付'
const DISBURSE_CODE_PREFIX = 'BOF-'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function parseAmount(raw: string): number | null {
  const text = raw.trim()
  if (text === '') {
    return null
  }
  const value = Number(text)
  if (!Number.isFinite(value)) {
    return null
  }
  return value
}

// 批复金额校验：空值、非数字、负数、超过上限一律退回。
export function validateProjectAmount(raw: string): { ok: boolean; value: number | null; message: string } {
  const value = parseAmount(raw)
  if (value === null) {
    return { ok: false, value: null, message: '批复金额不是有效数字，按无效值退回，请重新填写' }
  }
  if (value < 0) {
    return { ok: false, value: null, message: '批复金额不能为负数，按无效值退回，请重新填写' }
  }
  if (value > PROJECT_AMOUNT_MAX) {
    return { ok: false, value: null, message: `批复金额超出上限 ${PROJECT_AMOUNT_MAX} 万元，按无效值退回` }
  }
  return { ok: true, value, message: '' }
}

// 工程类型只有一套来源：既有工程记录里已经出现过的类型。
// 登记表单和查询筛选都读这里，不另写字典，也不回炉改写旧记录。
export function projectTypeOptions(): string[] {
  const types = listRows('project')
    .map((row) => String(row['工程类型'] ?? '').trim())
    .filter((type) => type !== '')
  return [...new Set(types)].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

function amountOf(row: EntryRow): number {
  const value = Number(row['批复金额'])
  return Number.isFinite(value) ? value : Number.NaN
}

// 治理工程组合查询：编号、承建单位模糊匹配；类型多选取并集；金额按上下限、日期按起止卡区间；
// 各条件之间取交集；可按批复金额升/降序。
export function listProjects(query: ProjectQuery = {}): PageResult {
  const code = query['工程编号']?.trim() ?? ''
  const contractor = query['承建单位']?.trim() ?? ''
  const types = (query['工程类型'] ?? []).filter((item) => item.trim() !== '')
  const minAmount = query['批复金额下限'] !== undefined ? parseAmount(query['批复金额下限']) : null
  const maxAmount = query['批复金额上限'] !== undefined ? parseAmount(query['批复金额上限']) : null
  const dateFrom = query['批复日期起']?.trim() ?? ''
  const dateTo = query['批复日期止']?.trim() ?? ''

  let matched = listRows('project').filter((row) => {
    if (code && !String(row['工程编号'] ?? '').includes(code)) {
      return false
    }
    if (contractor && !String(row['承建单位'] ?? '').includes(contractor)) {
      return false
    }
    if (types.length > 0 && !types.includes(String(row['工程类型'] ?? ''))) {
      return false
    }
    const amount = amountOf(row)
    if (minAmount !== null && (!Number.isFinite(amount) || amount < minAmount)) {
      return false
    }
    if (maxAmount !== null && (!Number.isFinite(amount) || amount > maxAmount)) {
      return false
    }
    const approvedAt = String(row['批复日期'] ?? '')
    if (dateFrom && approvedAt < dateFrom) {
      return false
    }
    if (dateTo && approvedAt > dateTo) {
      return false
    }
    return true
  })

  if (query['金额排序'] === 'asc' || query['金额排序'] === 'desc') {
    const direction = query['金额排序'] === 'asc' ? 1 : -1
    matched = [...matched].sort((a, b) => {
      const left = amountOf(a)
      const right = amountOf(b)
      // 金额缺失/非数字的记录统一沉底，不参与正常排序。
      if (!Number.isFinite(left) && !Number.isFinite(right)) {
        return 0
      }
      if (!Number.isFinite(left)) {
        return 1
      }
      if (!Number.isFinite(right)) {
        return -1
      }
      return (left - right) * direction
    })
  }

  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function nextRowId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 登记治理工程：必填校验、工程编号去重（反复提交不叠加）、批复金额合法性，落库即为「待批复」。
export function createProject(draft: ProjectDraft): ActionResult {
  const code = draft['工程编号'].trim()
  const hazard = draft['所属隐患点'].trim()
  const type = draft['工程类型'].trim()
  const approvedAt = draft['批复日期'].trim()
  const contractor = draft['承建单位'].trim()
  const finishedAt = draft['完工日期']?.trim() ?? ''

  const missing: string[] = []
  if (!code) missing.push('工程编号')
  if (!hazard) missing.push('所属隐患点')
  if (!type) missing.push('工程类型')
  if (!approvedAt) missing.push('批复日期')
  if (!contractor) missing.push('承建单位')
  if (missing.length > 0) {
    return { ok: false, message: `${missing.join('、')}不能为空，请补齐后再提交` }
  }

  const rows = listRows('project')
  if (rows.some((row) => String(row['工程编号'] ?? '').trim() === code)) {
    return { ok: false, message: `工程编号 ${code} 已登记过，同一编号反复提交不叠加记录` }
  }

  const amount = validateProjectAmount(draft['批复金额'])
  if (!amount.ok || amount.value === null) {
    return { ok: false, message: amount.message }
  }

  const row: EntryRow = {
    id: nextRowId(rows),
    status: '待批复',
    pending: true,
    abnormal: false,
    工程编号: code,
    所属隐患点: hazard,
    工程类型: type,
    批复日期: approvedAt,
    批复金额: amount.value,
    承建单位: contractor,
    完工日期: finishedAt,
    工程状态: '待批复',
  }
  saveRows('project', [...rows, row])
  return { ok: true, message: `治理工程 ${code} 已登记，当前状态「待批复」` }
}

// 工程批复通过后，往警示标识台账挂一条「待核拨付」。
// 以标识编号 BOF-<工程编号> 去重：同一工程反复提交，台账也只挂一条。
function createDisbursementLedger(project: EntryRow): void {
  const code = String(project['工程编号'] ?? '')
  const ledgerCode = `${DISBURSE_CODE_PREFIX}${code}`
  const rows = listRows('signboard')
  if (rows.some((row) => String(row['标识编号'] ?? '') === ledgerCode)) {
    return
  }
  const ledger: EntryRow = {
    id: nextRowId(rows),
    status: '待核拨付',
    pending: true,
    abnormal: false,
    标识编号: ledgerCode,
    所属隐患点: String(project['所属隐患点'] ?? ''),
    标识类别: DISBURSE_CATEGORY,
    设置位置: `治理工程${code}拨付台账`,
    设置日期: String(project['批复日期'] ?? ''),
    责任人: String(project['承建单位'] ?? ''),
    更换日期: '',
    标识状态: '待核拨付',
  }
  saveRows('signboard', [...rows, ledger])
}

function isClosedStatus(meta: ModuleMeta, status: string): boolean {
  const closed = meta.closedStatuses ?? [meta.statuses[meta.statuses.length - 1]]
  return closed.includes(status)
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 治理工程状态逐段推进：待批复→已批复→施工中→已竣工，跳级一律拦下。
  if (meta.sequential) {
    const currentIndex = meta.statuses.indexOf(current)
    const targetIndex = meta.statuses.indexOf(target)
    if (currentIndex < 0 || targetIndex !== currentIndex + 1) {
      return { ok: false, message: `${meta.entity}当前为「${current}」，不能直接跳到「${target}」，请逐段推进` }
    }
  }
  // 待核拨付台账只接受核拨动作，其他标识动作不能误改它。
  if (key === 'signboard' && current === '待核拨付' && action !== '登记核拨') {
    return { ok: false, message: '该记录是待核拨付台账，只能登记核拨' }
  }
  if (key === 'signboard' && action === '登记核拨' && current !== '待核拨付') {
    return { ok: false, message: '只有待核拨付的台账记录才能登记核拨' }
  }

  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !isClosedStatus(meta, target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)

  if (key === 'project' && action === '提交批复') {
    createDisbursementLedger(updated)
    return {
      ok: true,
      message: `${meta.entity}已${action}，当前状态「${target}」；警示标识台账已登记一条待核拨付`,
    }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
