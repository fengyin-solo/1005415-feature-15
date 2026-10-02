import './test-env.mjs'
import { listRows } from '@/data/local-store'
import {
  createProject,
  projectTypeOptions,
  queryProjects,
  runAction,
} from '@/api/local-service'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass += 1
    console.log(`PASS ${name}`)
  } else {
    fail += 1
    console.error(`FAIL ${name} ${extra}`)
  }
}

// 初始 3 条样例工程
check('初始工程数为 3', listRows('project').length === 3)
check('工程类型沿用既有记录', JSON.stringify(projectTypeOptions()) === JSON.stringify(['治理工程样例1', '治理工程样例2', '治理工程样例3']))

// 工程编号检索
check('按工程编号检索 PROJ-0002', queryProjects({ code: 'PROJ-0002', types: [], contractor: '', amountMin: null, amountMax: null, dateStart: '', dateEnd: '', sort: '' }).total === 1)
// 承建单位检索
check('按承建单位模糊检索', queryProjects({ code: '', types: [], contractor: '样例1', amountMin: null, amountMax: null, dateStart: '', dateEnd: '', sort: '' }).total === 1)
// 工程类型多选（组内 OR）
const multi = queryProjects({ code: '', types: ['治理工程样例1', '治理工程样例3'], contractor: '', amountMin: null, amountMax: null, dateStart: '', dateEnd: '', sort: '' })
check('工程类型多选命中 2 条', multi.total === 2 && multi.items.every((r) => String(r['工程类型']) !== '治理工程样例2'))
// 金额区间（12.5/25/37.5）
check('金额上下限区间', queryProjects({ code: '', types: [], contractor: '', amountMin: 20, amountMax: 30, dateStart: '', dateEnd: '', sort: '' }).total === 1)
// 日期区间
check('日期起止卡区间', queryProjects({ code: '', types: [], contractor: '', amountMin: null, amountMax: null, dateStart: '2026-09-02', dateEnd: '2026-09-02', sort: '' }).total === 1)
// 条件交集
check('条件叠加取交集', queryProjects({ code: 'PROJ', types: ['治理工程样例2'], contractor: '', amountMin: 10, amountMax: 100, dateStart: '2026-09-01', dateEnd: '2026-09-03', sort: '' }).total === 1)
check('无交集返回 0 条', queryProjects({ code: 'PROJ-0001', types: ['治理工程样例2'], contractor: '', amountMin: null, amountMax: null, dateStart: '', dateEnd: '', sort: '' }).total === 0)
// 排序
const asc = queryProjects({ code: '', types: [], contractor: '', amountMin: null, amountMax: null, dateStart: '', dateEnd: '', sort: 'amount_asc' })
check('金额升序', asc.items.map((r) => r['批复金额']).join(',') === '12.5,25,37.5')
const desc = queryProjects({ code: '', types: [], contractor: '', amountMin: null, amountMax: null, dateStart: '', dateEnd: '', sort: 'amount_desc' })
check('金额降序', desc.items.map((r) => r['批复金额']).join(',') === '37.5,25,12.5')

// 状态逐段推进：id1 待批复 → 开始施工（跳级）拦下
const skip = runAction('project', 1, '开始施工')
check('跳级被拦下', !skip.ok && skip.message.includes('逐段推进'), skip.message)
check('跳级不改变状态', String(listRows('project')[0].status) === '待批复')
// 正常推进 待批复→已批复
const step1 = runAction('project', 1, '提交批复')
check('待批复→已批复', step1.ok && String(listRows('project')[0].status) === '已批复')
// 已批复 → 确认竣工（跳级）拦下
const skip2 = runAction('project', 1, '确认竣工')
check('已批复跳竣工被拦下', !skip2.ok)
// 已批复→施工中→已竣工
check('已批复→施工中', runAction('project', 1, '开始施工').ok)
check('施工中→已竣工', runAction('project', 1, '确认竣工').ok)
// 重复动作
const dup = runAction('project', 1, '确认竣工')
check('重复动作拦下', !dup.ok && dup.message.includes('重复操作'))

// 金额负数退回
const neg = createProject({ code: 'PROJ-X1', hazard: 'h', type: '治理工程样例1', approvedDate: '2026-09-10', amount: -1, contractor: 'c', finishDate: '' })
check('负数金额退回', !neg.ok && neg.message.includes('无效值'), neg.message)
// 金额越界退回
const over = createProject({ code: 'PROJ-X2', hazard: 'h', type: '治理工程样例1', approvedDate: '2026-09-10', amount: 1e9, contractor: 'c', finishDate: '' })
check('越界金额退回', !over.ok && over.message.includes('无效值'), over.message)
// 非数字退回
const nan = createProject({ code: 'PROJ-X3', hazard: 'h', type: '治理工程样例1', approvedDate: '2026-09-10', amount: 'abc', contractor: 'c', finishDate: '' })
check('非数字金额退回', !nan.ok)
// 非法工程类型退回
const badType = createProject({ code: 'PROJ-X4', hazard: 'h', type: '挡墙支护', approvedDate: '2026-09-10', amount: 10, contractor: 'c', finishDate: '' })
check('不在册工程类型退回', !badType.ok && badType.message.includes('既有类型'), badType.message)

const signsBefore = listRows('signboard').length
// 正常提交
const ok = createProject({ code: 'PROJ-0100', hazard: 'H-南山滑坡', type: '治理工程样例2', approvedDate: '2026-10-01', amount: 88.8, contractor: '省地矿工程公司', finishDate: '' })
check('正常提交成功', ok.ok, ok.message)
check('工程数 +1', listRows('project').length === 4)
// 台账新增待核拨付
const signs = listRows('signboard')
check('警示标识台账 +1', signs.length === signsBefore + 1)
const added = signs[signs.length - 1]
check('台账类别为待核拨付', String(added['标识类别']) === '待核拨付' && String(added.status) === '待设置', JSON.stringify(added))
check('台账关联工程编号', String(added['设置位置']).includes('PROJ-0100'))
// 同一编号反复提交不叠加
const dupCode = createProject({ code: 'PROJ-0100', hazard: 'H-南山滑坡', type: '治理工程样例2', approvedDate: '2026-10-01', amount: 88.8, contractor: '省地矿工程公司', finishDate: '' })
check('同编号重复提交拦下', !dupCode.ok && dupCode.message.includes('不叠加'), dupCode.message)
check('重复提交不新增工程', listRows('project').length === 4)
check('重复提交不新增台账', listRows('signboard').length === signsBefore + 1)
// 新工程类型选项仍是同一套（不回炉）
check('工程类型不回炉', projectTypeOptions().length === 3)

// 其他模块原有非相邻跳转不受影响：drill 待组织→已评估（提交评估）原本就允许
const drillJump = runAction('drill', 1, '提交评估')
check('其他模块流转不受影响', drillJump.ok, drillJump.message)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
