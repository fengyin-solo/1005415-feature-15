/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 状态是否只能沿 statuses 逐段推进（true 时跳级动作一律拦下）
  sequential?: boolean
}

// 治理工程查询条件：多条件叠加取交集，工程类型多选为组内任一命中
export type ProjectQuery = {
  code: string
  types: string[]
  contractor: string
  amountMin: number | string | null
  amountMax: number | string | null
  dateStart: string
  dateEnd: string
  sort: '' | 'amount_asc' | 'amount_desc'
}

// 治理工程登记提交内容
export type ProjectDraft = {
  code: string
  hazard: string
  type: string
  approvedDate: string
  amount: number | string
  contractor: string
  finishDate: string
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
