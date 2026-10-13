<template>
  <aside class="scene-panel" aria-label="场景清单">
    <div class="scene-panel-head">
      <linshe-input v-model="keyword" size="sm" placeholder="搜索地点名或简介…" />
      <div class="scene-panel-filters">
        <linshe-select v-model="areaKey" size="sm" :options="areaOptions" placeholder="全部区域" />
        <linshe-select v-model="placeKey" size="sm" :options="placeOptions" :disabled="!areaKey" :placeholder="areaKey ? '全部地点' : '先选区域'" />
      </div>
      <div class="scene-panel-toggles">
        <linshe-button size="sm" variant="chip" :active="onlyWithImage" @click="onlyWithImage = !onlyWithImage">只看有图</linshe-button>
        <linshe-button size="sm" variant="chip" :active="onlyRestricted" @click="onlyRestricted = !onlyRestricted">只看受限</linshe-button>
        <linshe-button size="sm" variant="link" @click="resetFilters">清空</linshe-button>
      </div>
      <!-- 视图：平铺列表 / 缩略图网格 / 层级树。
           地图本身就是多层结构（顶层区域→城区→具体地点），
           平铺会把「区域 · 城区」这一整段路径在每一行重复一遍；树形把它说一次。 -->
      <div class="scene-panel-views" role="group" aria-label="清单视图">
        <linshe-button size="sm" variant="chip" :active="view === 'list'" @click="view = 'list'">列表</linshe-button>
        <linshe-button size="sm" variant="chip" :active="view === 'grid'" @click="view = 'grid'">缩略图</linshe-button>
        <linshe-button size="sm" variant="chip" :active="view === 'tree'" @click="view = 'tree'">树形</linshe-button>
        <linshe-button
          v-if="view === 'tree'"
          size="sm"
          variant="link"
          @click="collapseAll"
        >
          全部收起
        </linshe-button>
      </div>
      <p class="scene-panel-count">
        <template v-if="filtered.length">{{ filtered.length }} 处场景</template>
        <template v-else>没有匹配的场景</template>
      </p>
    </div>

    <div
      v-if="filtered.length && view === 'tree'"
      class="scene-panel-tree"
      role="tree"
      aria-label="场景层级树"
    >
      <template v-for="row in treeRows" :key="row.item.id">
        <div
          class="scene-tree-row"
          :class="{ active: row.item.id === activeId, branch: row.childCount > 0 }"
          :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
          role="treeitem"
          :aria-expanded="row.childCount > 0 ? expanded.has(row.item.id) : undefined"
          :aria-level="row.depth"
          tabindex="0"
          @click="onTreeRowClick(row)"
          @keydown.enter.prevent="onTreeRowClick(row)"
          @keydown.space.prevent="onTreeRowClick(row)"
        >
          <!-- 折叠箭头是独立热区：点箭头只开合，点行本身是选中该地点 -->
          <span
            v-if="row.childCount > 0"
            class="scene-tree-toggle"
            :class="{ open: expanded.has(row.item.id) }"
            role="button"
            tabindex="-1"
            :aria-label="expanded.has(row.item.id) ? '收起' : '展开'"
            @click.stop="toggleExpand(row.item.id)"
          >▶</span>
          <span v-else class="scene-tree-dot" aria-hidden="true"></span>

          <span class="scene-tree-thumb" :class="{ empty: !row.item.imageUrl }">
            <img v-if="row.item.imageUrl" :src="row.item.imageUrl" alt="" loading="lazy" />
            <span v-else aria-hidden="true">{{ glyphOf(row.item) }}</span>
          </span>
          <span class="scene-tree-text">
            <span class="scene-tree-name">{{ row.item.name }}</span>
            <!-- 分支给计数：收起时也能看出底下有多少内容 -->
            <span v-if="row.childCount > 0" class="scene-tree-count">{{ row.childCount }} 项{{ expanded.has(row.item.id) ? '' : '（已收起）' }}</span>
            <span v-else-if="row.item.summary" class="scene-tree-summary">{{ row.item.summary }}</span>
          </span>
          <span v-if="row.item.access === 'restricted' || row.item.access === 'private'" class="scene-tree-lock" aria-hidden="true">🔒</span>
        </div>
      </template>
    </div>

    <div
      v-else-if="filtered.length"
      class="scene-panel-list"
      :class="{ 'as-grid': view === 'grid' }"
      role="listbox"
      aria-label="场景列表"
    >
      <!-- 整卡热区：卡片自带 hover 上浮与缩略图版式，属于「已有独立设计的入口」，
           按 AGENTS.md 用 div[role=button] 自包含实现，不套 LinsheButton -->
      <div
        v-for="item in filtered"
        :key="item.id"
        class="scene-entry"
        :class="{ active: item.id === activeId, grid: view === 'grid' }"
        role="button"
        tabindex="0"
        :aria-selected="item.id === activeId"
        @click="select(item)"
        @keydown.enter.prevent="select(item)"
        @keydown.space.prevent="select(item)"
      >
        <span class="scene-entry-thumb" :class="{ empty: !item.imageUrl }">
          <img v-if="item.imageUrl" :src="item.imageUrl" alt="" loading="lazy" />
          <span v-else class="scene-entry-glyph" aria-hidden="true">{{ glyphOf(item) }}</span>
        </span>
        <span class="scene-entry-text">
          <span class="scene-entry-name">{{ item.name }}</span>
          <span class="scene-entry-path">{{ item.pathText }}</span>
          <span v-if="item.summary" class="scene-entry-summary">{{ item.summary }}</span>
        </span>
        <span v-if="item.access === 'restricted' || item.access === 'private'" class="scene-entry-lock" aria-hidden="true">🔒</span>
      </div>
    </div>
    <div v-else class="scene-panel-empty">
      <p>换个关键词或清空筛选试试。</p>
      <linshe-button size="sm" variant="ghost" @click="resetFilters">清空筛选</linshe-button>
    </div>
  </aside>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
import LinsheSelect from '../ui/LinsheSelect.vue'

const props = defineProps({
  /** 摊平后的场景列表（由页面 flattenTree 产出），本组件只做筛选与呈现 */
  items: { type: Array, default: () => [] },
  /** 当前选中的场景 id */
  activeId: { type: Number, default: 0 },
})

const emit = defineEmits(['select'])

const keyword = ref('')
const areaKey = ref('')
const placeKey = ref('')
const onlyWithImage = ref(false)
const onlyRestricted = ref(false)
/** 'list' | 'grid' | 'tree'：平铺扫读、按图扫读、按层级浏览 */
const view = ref('list')
/** 树形里已展开的节点 id。默认收起 —— 全摊开等于又变回平铺列表。 */
const expanded = ref(new Set())

const areaOptions = computed(() => {
  const seen = new Map()
  for (const p of props.items) {
    if (!p.areaKey) continue
    if (!seen.has(p.areaKey)) seen.set(p.areaKey, { label: p.areaName, value: p.areaKey })
  }
  return [...seen.values()]
})

const placeOptions = computed(() => {
  const seen = new Map()
  for (const p of props.items) {
    if (!areaKey.value || p.areaKey !== areaKey.value) continue
    if (!p.placeKey) continue
    if (!seen.has(p.placeKey)) seen.set(p.placeKey, { label: p.placeName, value: p.placeKey })
  }
  return [...seen.values()]
})

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return props.items.filter(p => {
    // 筛选语义：选区域=圈定该区域，选地点=在其中再收敛一层，两者是「过滤」而非「跳转」
    if (areaKey.value && p.areaKey !== areaKey.value) return false
    if (placeKey.value && p.placeKey !== placeKey.value) return false
    if (onlyWithImage.value && !p.imageUrl) return false
    if (onlyRestricted.value && p.access !== 'restricted' && p.access !== 'private') return false
    if (!kw) return true
    return (p.name || '').toLowerCase().includes(kw) || (p.summary || '').toLowerCase().includes(kw)
  })
})

// 换区域后原来的地点已不在候选集里，必须清掉，否则会筛出空列表
watch(areaKey, () => { placeKey.value = '' })

// 筛选一变，之前展开的节点可能已经不在结果里；留着会在下次筛到同一分支时
// 以「上次展开过」的姿态突然冒出来，反直觉，所以直接清空。
watch([keyword, areaKey, placeKey, onlyWithImage, onlyRestricted], () => {
  expanded.value = new Set()
})

/**
 * 树形行：按 parentId 把过滤结果重新挂回祖先链，只输出「父节点已展开」的行。
 * 直接用 flattenTree 给的 depth/parentId，不切 pathText（地名可能含「·」）。
 */
const treeRows = computed(() => {
  const byId = new Map(props.items.map(p => [p.id, p]))
  // 子节点计数按**全量**算：筛选只是把父子一起收窄，
  // 计数要反映「这项底下本来有多少」，否则收起来看不出规模。
  const childCount = new Map()
  for (const p of props.items) {
    if (!p.parentId) continue
    childCount.set(p.parentId, (childCount.get(p.parentId) || 0) + 1)
  }

  const rows = []
  for (const item of filtered.value) {
    // 祖先链上任一段没被展开，这一行就先不出现
    let cur = item
    let hidden = false
    while (cur && cur.parentId) {
      const parent = byId.get(cur.parentId)
      if (!parent) break
      if (!expanded.value.has(parent.id)) { hidden = true; break }
      cur = parent
    }
    if (hidden) continue
    rows.push({ item, depth: item.depth || 1, childCount: childCount.get(item.id) || 0 })
  }
  return rows
})

function toggleExpand(id) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function collapseAll() {
  expanded.value = new Set()
}

/** 点行 = 选中；若这行本身有下级，顺带把它展开（避免「点了没反应」） */
function onTreeRowClick(row) {
  select(row.item)
  if (row.childCount > 0 && !expanded.value.has(row.item.id)) toggleExpand(row.item.id)
}

/** 无缩略图时用地点名首字占位，让清单仍可扫读 */
function glyphOf(item) {
  return (item.name || '?').trim().slice(0, 1)
}

function resetFilters() {
  keyword.value = ''
  areaKey.value = ''
  placeKey.value = ''
  onlyWithImage.value = false
  onlyRestricted.value = false
}

function select(item) {
  emit('select', item.id)
}

defineExpose({ resetFilters })
</script>

<style scoped>
.scene-panel {
  display: flex;
  flex-direction: column;
  width: 320px;
  flex: 0 0 320px;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 14px);
  background: var(--bg-secondary);
  overflow: hidden;
}
.scene-panel-head { display: flex; flex-direction: column; gap: 10px; padding: 14px 14px 10px; border-bottom: 1px dashed var(--border); }
/* 两个下拉各占一行是刻意的：320px 宽里并排会把地名截断成「长乐…」 */
.scene-panel-filters { display: flex; flex-direction: column; gap: 8px; }
.scene-panel-toggles { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.scene-panel-count { margin: 0; color: var(--text-secondary); font-size: var(--fs-xs, 12px); }
.scene-panel-list { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.scene-entry {
  display: flex; align-items: center; gap: 10px;
  padding: 8px; border-radius: var(--radius-md, 10px);
  border: 1px solid transparent;
  cursor: pointer; text-align: left;
  transition: background-color .15s ease, border-color .15s ease, transform .15s ease;
}
.scene-entry:hover { background: var(--bg-tertiary); border-color: var(--border); transform: translateY(-1px); }
.scene-entry.active { background: rgba(var(--accent-rgb), 0.1); border-color: var(--accent-light); }
.scene-entry:focus-visible { outline: 3px solid rgba(var(--accent-rgb), 0.3); outline-offset: 1px; }
.scene-entry-thumb {
  flex: 0 0 48px; width: 48px; height: 48px; border-radius: var(--radius-sm, 8px);
  overflow: hidden; background: var(--bg-sunken); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
}
.scene-entry-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.scene-entry-glyph { color: var(--text-secondary); font-size: var(--fs-lg, 1.1rem); font-weight: 600; }
.scene-entry-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.scene-entry-name { font-size: var(--fs-sm); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scene-entry-path { font-size: var(--fs-xs, 12px); color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 简介限两行：清单要能扫读，不能变成一堆长文 */
.scene-entry-summary {
  font-size: var(--fs-xs, 12px); color: var(--text-secondary); line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.scene-entry-lock { flex: 0 0 auto; font-size: var(--fs-xs, 12px); }

/* 视图切换只调整位置，皮肤交给 LinsheButton 的 chip 变体
   （AGENTS.md：不要在各页面里覆盖组件皮肤） */
.scene-panel-views { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }

/* ── 树形清单 ── */
.scene-panel-tree { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 2px; }
.scene-tree-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: var(--radius-sm, 8px);
  border: 1px solid transparent;
  cursor: pointer; text-align: left;
  transition: background-color .15s ease, border-color .15s ease;
}
.scene-tree-row:hover { background: var(--bg-tertiary); border-color: var(--border); }
.scene-tree-row.active { background: rgba(var(--accent-rgb), 0.1); border-color: var(--accent-light); }
.scene-tree-row:focus-visible { outline: 3px solid rgba(var(--accent-rgb), 0.3); outline-offset: 1px; }
/* 分支行给一点字重，和叶子区分开 */
.scene-tree-row.branch .scene-tree-name { font-weight: 600; color: var(--text-bright); }
.scene-tree-toggle {
  flex: 0 0 16px; width: 16px; height: 16px; line-height: 16px;
  text-align: center; font-size: 9px; color: var(--text-secondary);
  cursor: pointer; transition: transform .15s ease; user-select: none;
}
.scene-tree-toggle.open { transform: rotate(90deg); }
.scene-tree-dot { flex: 0 0 16px; width: 16px; }
.scene-tree-thumb {
  flex: 0 0 26px; width: 26px; height: 26px; border-radius: var(--radius-sm, 8px);
  overflow: hidden; background: var(--bg-sunken); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-xs, 12px); color: var(--text-secondary);
}
.scene-tree-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.scene-tree-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.scene-tree-name { font-size: var(--fs-sm); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scene-tree-count { font-size: var(--fs-xs, 12px); color: var(--text-secondary); }
.scene-tree-summary {
  font-size: var(--fs-xs, 12px); color: var(--text-secondary); line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.scene-tree-lock { flex: 0 0 auto; font-size: var(--fs-xs, 12px); }

/* 缩略图网格：两列铺开，图占主导；没出图的用首字占位块顶上，
   保证网格不会因为缺图塌成一行文字 */
.scene-panel-list.as-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px; align-content: start;
}
.scene-entry.grid {
  position: relative; flex-direction: column; align-items: stretch; gap: 6px;
  padding: 6px; border-color: var(--border);
}
.scene-entry.grid .scene-entry-thumb {
  flex: 0 0 auto; width: 100%; height: 96px; border-radius: var(--radius-sm, 8px);
}
.scene-entry.grid .scene-entry-glyph { font-size: 1.6rem; }
.scene-entry.grid .scene-entry-text { gap: 2px; }
/* 网格里只留名字 + 路径：简介会把卡片撑得高低不齐，扫读价值也低 */
.scene-entry.grid .scene-entry-summary { display: none; }
.scene-entry.grid .scene-entry-name { white-space: normal; -webkit-line-clamp: 2; line-clamp: 2; display: -webkit-box; -webkit-box-orient: vertical; }
.scene-entry.grid .scene-entry-lock { position: absolute; top: 10px; right: 12px; }
.scene-panel-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; color: var(--text-secondary); text-align: center; }
.scene-panel-empty p { margin: 0; font-size: var(--fs-sm); }

@media (max-width: 768px) {
  .scene-panel { width: 100%; flex: 1 1 auto; }
}
</style>