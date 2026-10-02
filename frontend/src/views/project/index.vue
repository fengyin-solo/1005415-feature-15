<template>
  <section class="page" data-module="project">
    <header class="page-head">
      <div>
        <h2>治理工程管理</h2>
        <p class="page-desc">维护治理工程，围绕工程编号、工程类型、承建单位、批复金额、批复日期做登记、组合查询、排序与逐段状态流转。</p>
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

    <form class="filter-bar project-filter" @submit.prevent="reload">
      <label class="filter-item">
        <span>工程编号</span>
        <input v-model="query['工程编号']" placeholder="按工程编号检索" />
      </label>
      <label class="filter-item">
        <span>承建单位</span>
        <input v-model="query['承建单位']" placeholder="按承建单位检索" />
      </label>
      <fieldset class="filter-item type-filter">
        <legend>工程类型（多选）</legend>
        <div v-if="typeOptions.length" class="check-row">
          <label v-for="type in typeOptions" :key="type" class="check-item">
            <input
              type="checkbox"
              :value="type"
              :checked="selectedTypes.includes(type)"
              @change="toggleType(type)"
            />
            <span>{{ type }}</span>
          </label>
        </div>
        <span v-else class="filter-hint">台账里还没有工程类型，先登记工程沿用既有类型</span>
      </fieldset>
      <label class="filter-item">
        <span>批复金额下限（万元）</span>
        <input v-model="query['批复金额下限']" type="number" min="0" placeholder="金额下限" />
      </label>
      <label class="filter-item">
        <span>批复金额上限（万元）</span>
        <input v-model="query['批复金额上限']" type="number" min="0" placeholder="金额上限" />
      </label>
      <label class="filter-item">
        <span>批复日期起</span>
        <input v-model="query['批复日期起']" type="date" />
      </label>
      <label class="filter-item">
        <span>批复日期止</span>
        <input v-model="query['批复日期止']" type="date" />
      </label>
      <label class="filter-item">
        <span>批复金额排序</span>
        <select v-model="query['金额排序']">
          <option value="">不排序</option>
          <option value="asc">金额从低到高</option>
          <option value="desc">金额从高到低</option>
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
          <td :colspan="columns.length + 2" class="empty-state">没有命中查询条件的治理工程，可调整条件或登记新工程</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条治理工程记录（状态逐段推进：待批复 → 已批复 → 施工中 → 已竣工，跳级会被拦下）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="showCreate" class="modal-mask" @click.self="closeCreate">
      <div class="modal-card">
        <h3 class="modal-title">登记治理工程</h3>
        <p class="modal-hint">工程编号重复提交不会叠加；批复金额单位为万元，负数或超过 {{ amountMax }} 万元按无效值退回。</p>
        <form class="create-form" @submit.prevent="submitCreate">
          <label class="form-item">
            <span>工程编号 *</span>
            <input v-model="draft['工程编号']" placeholder="如 PROJ-0004" />
          </label>
          <label class="form-item">
            <span>所属隐患点 *</span>
            <input v-model="draft['所属隐患点']" placeholder="所属隐患点编号或名称" />
          </label>
          <label class="form-item">
            <span>工程类型 *（沿用既有类型）</span>
            <select v-model="draft['工程类型']">
              <option value="" disabled>请选择既有工程类型</option>
              <option v-for="type in typeOptions" :key="type" :value="type">{{ type }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>批复日期 *</span>
            <input v-model="draft['批复日期']" type="date" />
          </label>
          <label class="form-item">
            <span>批复金额 *（万元）</span>
            <input v-model="draft['批复金额']" type="number" min="0" placeholder="非负且不超过上限" />
          </label>
          <label class="form-item">
            <span>承建单位 *</span>
            <input v-model="draft['承建单位']" placeholder="承建单位名称" />
          </label>
          <label class="form-item">
            <span>完工日期</span>
            <input v-model="draft['完工日期']" type="date" />
          </label>
          <p v-if="createError" class="error-text form-error">{{ createError }}</p>
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
import { computed, onMounted, ref } from 'vue'

import {
  PROJECT_AMOUNT_MAX,
  createProject,
  downloadEntries,
  listProjects,
  moduleMeta,
  projectTypeOptions,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, ProjectDraft, ProjectQuery } from '@/data/types'

const meta = moduleMeta('project')
const columns = ["工程编号", "所属隐患点", "工程类型", "批复日期", "批复金额", "承建单位", "完工日期", "工程状态"]
const actions = ["提交批复", "开始施工", "确认竣工"]
const statuses = ["待批复", "已批复", "施工中", "已竣工"]
const stats = [{"label": "施工中工程", "value": 0}, {"label": "待批复工程", "value": 0}, {"label": "已竣工工程", "value": 0}]
const amountMax = PROJECT_AMOUNT_MAX

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const typeOptions = ref<string[]>([])

function emptyQuery(): ProjectQuery {
  return {
    工程编号: '',
    承建单位: '',
    工程类型: [],
    批复金额下限: '',
    批复金额上限: '',
    批复日期起: '',
    批复日期止: '',
    金额排序: '',
  }
}

const query = ref<ProjectQuery>(emptyQuery())
const selectedTypes = computed(() => query.value['工程类型'] ?? [])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const showCreate = ref(false)
const createError = ref('')

function emptyDraft(): ProjectDraft {
  return {
    工程编号: '',
    所属隐患点: '',
    工程类型: '',
    批复日期: '',
    批复金额: '',
    承建单位: '',
    完工日期: '',
  }
}

const draft = ref<ProjectDraft>(emptyDraft())

function toggleType(type: string) {
  const selected = query.value['工程类型'] ?? []
  query.value['工程类型'] = selected.includes(type)
    ? selected.filter((item) => item !== type)
    : [...selected, type]
}

function resetFilters() {
  query.value = emptyQuery()
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  draft.value = emptyDraft()
  createError.value = ''
  showCreate.value = true
}

function closeCreate() {
  showCreate.value = false
  createError.value = ''
}

function submitCreate() {
  const result = createProject(draft.value)
  if (!result.ok) {
    createError.value = result.message
    return
  }
  showCreate.value = false
  errorMessage.value = result.message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    typeOptions.value = projectTypeOptions()
    const payload = listProjects(query.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '治理工程列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.project-filter {
  align-items: flex-start;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}
.filter-item input,
.filter-item select,
.form-item input,
.form-item select {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 13px;
}
.type-filter {
  border: none;
  padding: 0;
  margin: 0;
}
.type-filter legend {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.check-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-width: 420px;
}
.check-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 13px;
  white-space: nowrap;
}
.filter-hint {
  font-size: 12px;
  color: var(--muted);
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 560px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 60px);
  overflow: auto;
}
.modal-title {
  margin: 0 0 6px;
  font-size: 16px;
}
.modal-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--muted);
}
.create-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
}
.form-item span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 3px;
}
.form-item input,
.form-item select {
  width: 100%;
}
.form-error {
  grid-column: 1 / -1;
  margin: 0;
}
.modal-actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
</style>
