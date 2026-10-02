<template>
  <section class="page" data-module="project">
    <header class="page-head">
      <div>
        <h2>治理工程管理</h2>
        <p class="page-desc">维护治理工程，围绕工程编号、所属隐患点、工程类型、批复日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记治理工程</button>
        <button class="btn" type="button" @click="exportRows">导出治理工程清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>工程编号</span>
        <input v-model="query.code" placeholder="按工程编号检索" />
      </label>
      <label class="filter-item">
        <span>承建单位</span>
        <input v-model="query.contractor" placeholder="按承建单位检索" />
      </label>
      <fieldset class="filter-group">
        <legend>工程类型（多选，命中任一）</legend>
        <div v-if="typeOptions.length" class="check-row">
          <label v-for="type in typeOptions" :key="type" class="check-item">
            <input v-model="query.types" type="checkbox" :value="type" />
            {{ type }}
          </label>
        </div>
        <span v-else class="filter-hint">暂无可选工程类型</span>
      </fieldset>
      <label class="filter-item">
        <span>批复金额下限（万元）</span>
        <input v-model="amountMinInput" type="number" min="0" placeholder="下限" />
      </label>
      <label class="filter-item">
        <span>批复金额上限（万元）</span>
        <input v-model="amountMaxInput" type="number" min="0" placeholder="上限" />
      </label>
      <label class="filter-item">
        <span>批复起始日</span>
        <input v-model="query.dateStart" type="date" />
      </label>
      <label class="filter-item">
        <span>批复截止日</span>
        <input v-model="query.dateEnd" type="date" />
      </label>
      <label class="filter-item">
        <span>按批复金额排序</span>
        <select v-model="query.sort">
          <option value="">不排序</option>
          <option value="amount_asc">金额从低到高</option>
          <option value="amount_desc">金额从高到低</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无符合条件的治理工程数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条治理工程记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>

    <div v-if="showCreate" class="modal-mask" @click.self="closeCreate">
      <div class="modal">
        <h3 class="modal-title">登记治理工程</h3>
        <form class="modal-body" @submit.prevent="submitCreate">
          <label class="form-item">
            <span>工程编号 *</span>
            <input v-model="form.code" placeholder="例如 PROJ-0010" />
          </label>
          <label class="form-item">
            <span>所属隐患点 *</span>
            <input v-model="form.hazard" placeholder="所属隐患点编号或名称" />
          </label>
          <label class="form-item">
            <span>工程类型 *</span>
            <select v-model="form.type">
              <option value="" disabled>请选择既有工程类型</option>
              <option v-for="type in typeOptions" :key="type" :value="type">{{ type }}</option>
            </select>
            <small v-if="!typeOptions.length" class="filter-hint">既有记录里暂无工程类型，可先重置模块</small>
          </label>
          <label class="form-item">
            <span>批复日期 *</span>
            <input v-model="form.approvedDate" type="date" />
          </label>
          <label class="form-item">
            <span>批复金额（万元）*</span>
            <input v-model="amountInput" type="number" min="0" placeholder="不允许负数" />
          </label>
          <label class="form-item">
            <span>承建单位 *</span>
            <input v-model="form.contractor" placeholder="承建单位名称" />
          </label>
          <label class="form-item">
            <span>完工日期</span>
            <input v-model="form.finishDate" type="date" />
          </label>
          <p v-if="formError" class="error-text">{{ formError }}</p>
          <div class="modal-actions">
            <button class="btn primary" type="submit">提交登记</button>
            <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createProject,
  downloadEntries,
  moduleMeta,
  projectTypeOptions,
  queryProjects,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, ProjectQuery } from '@/data/types'

const meta = moduleMeta('project')
const columns = ["工程编号", "所属隐患点", "工程类型", "批复日期", "批复金额", "承建单位", "完工日期", "工程状态"]
const actions = ["提交批复", "开始施工", "确认竣工"]
const statuses = ["待批复", "已批复", "施工中", "已竣工"]
const stats = [{"label": "施工中工程", "value": 0}, {"label": "待批复工程", "value": 0}, {"label": "已竣工工程", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const amountMinInput = ref('')
const amountMaxInput = ref('')

const query = reactive<ProjectQuery>({
  code: '',
  types: [],
  contractor: '',
  amountMin: null,
  amountMax: null,
  dateStart: '',
  dateEnd: '',
  sort: '',
})

// 工程类型只认既有记录里的同一套：查询多选与登记表单共用。
const typeOptions = ref<string[]>([])
const showCreate = ref(false)
const formError = ref('')
const amountInput = ref('')
const form = reactive({
  code: '',
  hazard: '',
  type: '',
  approvedDate: '',
  contractor: '',
  finishDate: '',
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  query.code = ''
  query.types = []
  query.contractor = ''
  query.amountMin = null
  query.amountMax = null
  query.dateStart = ''
  query.dateEnd = ''
  query.sort = ''
  amountMinInput.value = ''
  amountMaxInput.value = ''
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  typeOptions.value = projectTypeOptions()
  formError.value = ''
  form.code = ''
  form.hazard = ''
  form.type = typeOptions.value.length === 1 ? typeOptions.value[0] : ''
  form.approvedDate = ''
  form.contractor = ''
  form.finishDate = ''
  amountInput.value = ''
  showCreate.value = true
}

function closeCreate() {
  showCreate.value = false
}

function submitCreate() {
  formError.value = ''
  const result = createProject({
    code: form.code,
    hazard: form.hazard,
    type: form.type,
    approvedDate: form.approvedDate,
    amount: amountInput.value,
    contractor: form.contractor,
    finishDate: form.finishDate,
  })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  showCreate.value = false
  successMessage.value = result.message
  errorMessage.value = ''
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  successMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  successMessage.value = ''
  try {
    query.amountMin = amountMinInput.value.trim() === '' ? null : amountMinInput.value
    query.amountMax = amountMaxInput.value.trim() === '' ? null : amountMaxInput.value
    typeOptions.value = projectTypeOptions()
    const payload = queryProjects(query)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '治理工程列表读取失败'
  }
}

onMounted(reload)
</script>
