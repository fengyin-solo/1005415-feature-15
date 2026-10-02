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

// 批复金额允许的合理区间（万元），超出上界或填成负数都按无效值退回。
const PROJECT_AMOUNT_MIN = 0
const PROJECT_AMOUNT_MAX = 100_000_000
const PROJECT_KEY = 'project'
const SIGNBOARD_KEY = 'signboard'
// 治理工程提交后写入警示标识台账的核拨待办
const SIGN_PENDING_ALLOCATION = '待核拨付'

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

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null
  }
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

// 两条路径（查询条件多选、登记表单下拉）读工程类型都走这里：沿用既有记录里的类型，不回炉。
export function projectTypeOptions(): string[] {
  const seen = new Set<string>()
  for (const row of listRows(PROJECT_KEY)) {
    const type = String(row['工程类型'] ?? '').trim()
    if (type) {
      seen.add(type)
    }
  }
  return [...seen]
}

// 治理工程专属查询：各条件叠加取交集，工程类型多选为组内任一命中，另支持批复金额排序。
export function queryProjects(query: ProjectQuery): PageResult {
  const code = query.code.trim()
  const contractor = query.contractor.trim()
  const types = query.types.map((item) => item.trim()).filter(Boolean)
  const amountMin = toNumber(query.amountMin)
  const amountMax = toNumber(query.amountMax)
  const dateStart = query.dateStart
  const dateEnd = query.dateEnd

  let items = listRows(PROJECT_KEY).filter((row) => {
    if (code && !String(row['工程编号'] ?? '').includes(code)) {
      return false
    }
    if (contractor && !String(row['承建单位'] ?? '').includes(contractor)) {
      return false
    }
    if (types.length > 0 && !types.includes(String(row['工程类型'] ?? ''))) {
      return false
    }
    const amount = Number(row['批复金额'])
    if (amountMin !== null && (!Number.isFinite(amount) || amount < amountMin)) {
      return false
    }
    if (amountMax !== null && (!Number.isFinite(amount) || amount > amountMax)) {
      return false
    }
    const date = String(row['批复日期'] ?? '')
    if (dateStart && (!date || date < dateStart)) {
      return false
    }
    if (dateEnd && (!date || date > dateEnd)) {
      return false
    }
    return true
  })

  if (query.sort === 'amount_asc' || query.sort === 'amount_desc') {
    const dir = query.sort === 'amount_asc' ? 1 : -1
    items = [...items].sort((a, b) => {
      const left = Number(a['批复金额'])
      const right = Number(b['批复金额'])
      const leftNum = Number.isFinite(left) ? left : NaN
      const rightNum = Number.isFinite(right) ? right : NaN
      // 非数值金额一律沉底，不受排序方向影响
      if (Number.isNaN(leftNum) && Number.isNaN(rightNum)) return 0
      if (Number.isNaN(leftNum)) return 1
      if (Number.isNaN(rightNum)) return -1
      return (leftNum - rightNum) * dir
    })
  }

  return { items, total: items.length, page: 1, size: items.length }
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
  // 逐段推进的模块：目标状态必须紧挨当前状态，跳级一律拦下。
  if (meta.sequential) {
    const currentIndex = meta.statuses.indexOf(current)
    const targetIndex = meta.statuses.indexOf(target)
    if (currentIndex < 0 || targetIndex !== currentIndex + 1) {
      return {
        ok: false,
        message: `${meta.entity}状态只能按「${meta.statuses.join('→')}」逐段推进，不能从「${current}」直接跳到「${target}」`,
      }
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function nextSerialId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 登记治理工程：同一工程编号反复提交结果不叠加；金额越界或负数按无效值退回；
// 提交成功后在警示标识台账追加一条「待核拨付」待办。
export function createProject(draft: ProjectDraft): ActionResult {
  const code = draft.code.trim()
  if (!code) {
    return { ok: false, message: '工程编号不能为空' }
  }
  const projects = listRows(PROJECT_KEY)
  if (projects.some((row) => String(row['工程编号'] ?? '') === code)) {
    return { ok: false, message: `工程编号「${code}」已存在，重复提交不叠加` }
  }
  const hazard = draft.hazard.trim()
  if (!hazard) {
    return { ok: false, message: '所属隐患点不能为空' }
  }
  const type = draft.type.trim()
  if (!type) {
    return { ok: false, message: '工程类型不能为空' }
  }
  // 工程类型沿用既有记录里的同一套，不回炉，提交不在册的类型直接退回。
  if (!projectTypeOptions().includes(type)) {
    return { ok: false, message: `工程类型「${type}」不在既有类型中，请从既有工程类型里选择` }
  }
  const approvedDate = draft.approvedDate.trim()
  if (!approvedDate) {
    return { ok: false, message: '批复日期不能为空' }
  }
  const contractor = draft.contractor.trim()
  if (!contractor) {
    return { ok: false, message: '承建单位不能为空' }
  }
  const amount = toNumber(draft.amount)
  if (amount === null) {
    return { ok: false, message: '批复金额必须填数字，当前为无效值' }
  }
  if (amount < PROJECT_AMOUNT_MIN || amount > PROJECT_AMOUNT_MAX) {
    return {
      ok: false,
      message: `批复金额 ${amount} 超出允许区间（${PROJECT_AMOUNT_MIN}~${PROJECT_AMOUNT_MAX} 万元）或为负数，按无效值退回`,
    }
  }

  const finishDate = draft.finishDate.trim()
  const projectRow: EntryRow = {
    id: nextSerialId(projects),
    status: '待批复',
    pending: true,
    abnormal: false,
    工程编号: code,
    所属隐患点: hazard,
    工程类型: type,
    批复日期: approvedDate,
    批复金额: amount,
    承建单位: contractor,
    完工日期: finishDate,
    工程状态: '待批复',
  }
  saveRows(PROJECT_KEY, [...projects, projectRow])

  // 提交结果落到警示标识台账：新增一条「待核拨付」待设置记录，指向同一工程。
  const signboards = listRows(SIGNBOARD_KEY)
  const signId = nextSerialId(signboards)
  const signRow: EntryRow = {
    id: signId,
    status: '待设置',
    pending: true,
    abnormal: false,
    标识编号: `SIGN-${String(signId).padStart(4, '0')}`,
    所属隐患点: hazard,
    标识类别: SIGN_PENDING_ALLOCATION,
    设置位置: `治理工程 ${code}`,
    设置日期: approvedDate,
    责任人: contractor,
    更换日期: '',
    标识状态: '待设置',
  }
  saveRows(SIGNBOARD_KEY, [...signboards, signRow])

  return {
    ok: true,
    message: `治理工程「${code}」已登记（待批复），警示标识台账已同步新增一条「${SIGN_PENDING_ALLOCATION}」待办`,
  }
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
