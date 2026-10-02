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
  // 终态可能不止一个（如警示标识的「已撤除」「已核拨」），落到终态的记录不再算待处理。
  closedStatuses?: string[]
  // 打开后状态只能沿 statuses 顺序逐段推进，跳级动作一律拦下。
  sequential?: boolean
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

// 治理工程查询条件：文本字段模糊匹配，金额/日期按区间卡，工程类型多选取并集，条件之间取交集。
export type ProjectQuery = {
  工程编号?: string
  承建单位?: string
  工程类型?: string[]
  批复金额下限?: string
  批复金额上限?: string
  批复日期起?: string
  批复日期止?: string
  金额排序?: '' | 'asc' | 'desc'
}

// 登记治理工程的提交内容：批复金额以文本接收，由服务层统一校验，非法值不进数据层。
export type ProjectDraft = {
  工程编号: string
  所属隐患点: string
  工程类型: string
  批复日期: string
  批复金额: string
  承建单位: string
  完工日期?: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
