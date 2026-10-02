// 治理工程业务逻辑冒烟测试：由 /tmp/run-smoke.mjs 打包后在 node 里执行。
const memory = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => (memory.has(key) ? (memory.get(key) as string) : null),
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
}
;(globalThis as any).window = { localStorage: localStorageStub }
;(globalThis as any).localStorage = localStorageStub

import {
  createProject,
  listProjects,
  projectTypeOptions,
  runAction,
  resetModule,
  validateProjectAmount,
} from '@/api/local-service'
import { listRows } from '@/data/local-store'

let passed = 0
function check(name: string, cond: boolean, extra = '') {
  if (!cond) {
    console.error('FAIL:', name, extra)
    process.exitCode = 1
  } else {
    passed++
    console.log('PASS:', name)
  }
}

// 清成种子数据，再用新工程编号登记若干条（工程类型沿用种子里已出现的类型）
resetModule('project')
resetModule('signboard')
const seedTypes = projectTypeOptions()
check('工程类型来自既有记录', seedTypes.includes('治理工程样例1') && seedTypes.includes('治理工程样例3'), seedTypes.join('|'))

const mk = (code: string, type: string, amount: string, date: string, contractor: string) =>
  createProject({ 工程编号: code, 所属隐患点: 'H-1', 工程类型: type, 批复日期: date, 批复金额: amount, 承建单位: contractor })

check('登记A成功', mk('PROJ-T01', '治理工程样例1', '100', '2026-05-01', '长江岩土公司').ok)
check('登记B成功', mk('PROJ-T02', '治理工程样例2', '300', '2026-06-01', '黄河工程局').ok)
check('登记C成功', mk('PROJ-T03', '治理工程样例1', '500', '2026-07-01', '长江岩土公司').ok)

// 同一工程编号反复提交不叠加
const dup = mk('PROJ-T01', '治理工程样例1', '100', '2026-05-01', '长江岩土公司')
check('重复编号被拒', !dup.ok && dup.message.includes('不叠加'), dup.message)
check('重复编号不增记录', listRows('project').filter((r) => r['工程编号'] === 'PROJ-T01').length === 1)

// 金额校验：负数、越界、非数字
check('负数金额退回', !validateProjectAmount('-1').ok)
check('越界金额退回', !validateProjectAmount('100001').ok)
check('非数字金额退回', !validateProjectAmount('abc').ok)
check('边界上限有效', validateProjectAmount('100000').ok)
check('正常金额有效', validateProjectAmount('100').ok)
check('零金额有效', validateProjectAmount('0').ok)
const badNeg = mk('PROJ-T04', '治理工程样例1', '-5', '2026-05-01', '某单位')
check('负数登记退回', !badNeg.ok && badNeg.message.includes('负数'))
const badOver = mk('PROJ-T05', '治理工程样例1', '999999', '2026-05-01', '某单位')
check('越界登记退回', !badOver.ok && badOver.message.includes('上限'))
check('退回后不落库', !listRows('project').some((r) => ['PROJ-T04', 'PROJ-T05'].includes(String(r['工程编号']))))

// 必填校验
const miss = createProject({ 工程编号: '', 所属隐患点: '', 工程类型: '', 批复日期: '', 批复金额: '1', 承建单位: '' })
check('必填项拦截', !miss.ok && miss.message.includes('不能为空'))

// 新登记默认待批复
const t01 = listRows('project').find((r) => r['工程编号'] === 'PROJ-T01')!
check('新登记为待批复', String(t01.status) === '待批复' && t01.pending === true)

// 跳级拦截：待批复不能直接开始施工/确认竣工
const jump1 = runAction('project', Number(t01.id), '开始施工')
check('跳级施工被拦', !jump1.ok && jump1.message.includes('逐段推进'), jump1.message)
const jump2 = runAction('project', Number(t01.id), '确认竣工')
check('跳级竣工被拦', !jump2.ok && jump2.message.includes('逐段推进'), jump2.message)

// 提交批复：状态推进 + 台账联动
const approve = runAction('project', Number(t01.id), '提交批复')
check('提交批复成功', approve.ok && approve.message.includes('已批复'), approve.message)
const ledger = listRows('signboard').filter((r) => String(r['标识编号']) === 'BOF-PROJ-T01')
check('台账挂一条待核拨付', ledger.length === 1 && String(ledger[0].status) === '待核拨付', JSON.stringify(ledger))
check('台账字段完整', String(ledger[0]?.['标识类别']) === '治理工程待核拨付' && String(ledger[0]?.['责任人']) === '长江岩土公司')

// 已批复再提交批复是重复操作；台账仍只有一条（幂等）
const approveAgain = runAction('project', Number(t01.id), '提交批复')
check('重复提交批复拦截', !approveAgain.ok)
check('台账幂等不叠加', listRows('signboard').filter((r) => String(r['标识编号']) === 'BOF-PROJ-T01').length === 1)

// 台账不能被普通标识动作误改
const wrong = runAction('signboard', Number(ledger[0].id), '确认设置')
check('台账拒绝普通动作', !wrong.ok && wrong.message.includes('登记核拨'))
// 非台账记录不能登记核拨
const normalSign = listRows('signboard').find((r) => String(r.status) === '待设置')!
const wrong2 = runAction('signboard', Number(normalSign.id), '登记核拨')
check('普通标识不能核拨', !wrong2.ok)
// 核拨成功
const paid = runAction('signboard', Number(ledger[0].id), '登记核拨')
check('登记核拨成功', paid.ok)
check('核拨后为已核拨且不再待处理', String(listRows('signboard').find((r) => String(r['标识编号']) === 'BOF-PROJ-T01')!.status) === '已核拨')

// 逐级推进走通
const buildOk = runAction('project', Number(t01.id), '开始施工')
check('开始施工成功', buildOk.ok)
const finish = runAction('project', Number(t01.id), '确认竣工')
check('确认竣工成功', finish.ok)
const skipBack = runAction('project', Number(t01.id), '提交批复')
check('竣工后不能回头批复', !skipBack.ok)

// 查询：编号模糊
check('编号模糊命中', listProjects({ 工程编号: 'T01' }).total === 1)
// 承建单位模糊
check('承建单位交集', listProjects({ 承建单位: '长江' }).total === 2)
// 类型多选（并集）
check('类型多选取并集', listProjects({ 工程类型: ['治理工程样例1', '治理工程样例2'] }).total === 5) // 样例1种子1+T01+T03，样例2种子1+T02
// 条件叠加取交集：长江 + 类型样例1
check('条件叠加取交集', listProjects({ 承建单位: '长江', 工程类型: ['治理工程样例1'] }).total === 2)
// 金额区间
check('金额区间下限', listProjects({ 批复金额下限: '300' }).items.every((r) => Number(r['批复金额']) >= 300))
check('金额区间上下限', listProjects({ 批复金额下限: '100', 批复金额上限: '300' }).total === 2) // T01=100, T02=300
// 日期区间
check('日期区间过滤', listProjects({ 批复日期起: '2026-06-01', 批复日期止: '2026-06-30' }).total === 1)
// 排序
const asc = listProjects({ 金额排序: 'asc' }).items.map((r) => Number(r['批复金额']))
check('升序排列', asc.every((v, i) => i === 0 || v >= asc[i - 1]), asc.join(','))
const desc = listProjects({ 金额排序: 'desc' }).items.map((r) => Number(r['批复金额']))
check('降序排列', desc.every((v, i) => i === 0 || v <= desc[i - 1]), desc.join(','))
// 区间 + 类型 + 排序叠加
const mix = listProjects({ 批复金额下限: '200', 工程类型: ['治理工程样例1'], 金额排序: 'desc' }).items.map((r) => String(r['工程编号']))
check('组合查询叠加', mix.length === 1 && mix[0] === 'PROJ-T03', mix.join(','))
// 无条件全量
check('无条件全量', listProjects({}).total === listRows('project').length)

console.log('\n' + passed + ' checks passed')
