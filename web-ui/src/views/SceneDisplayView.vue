<template>
  <main class="scene-display" :class="{ 'sidebar-shown': sidebarReady && isMobile }" aria-label="场景展示">
    <!-- 桌面：左清单 + 右详情。浏览 190+ 地点的主路径是「扫清单、挑一处」，
         原来的「一次一处翻页」把这条路径藏在弹窗里，且主区大片空白。 -->
    <div class="scene-layout">
      <SceneListPanel
        v-if="!isMobile"
        :items="list"
        :active-id="current ? current.id : 0"
        @select="jump"
      />

      <section class="scene-detail" aria-label="场景详情">
        <Transition name="scene-card" mode="out-in">
          <article v-if="current" :key="current.id" class="scene-stage">
            <div class="scene-body">
              <div class="scene-head">
                <div class="scene-title">
                  <h2 class="scene-name">{{ current.name }}</h2>
                  <p class="scene-path">{{ current.pathText }}</p>
                </div>
                <linshe-button size="sm" variant="ghost" @click="openRefine">✎ 修正</linshe-button>
              </div>

              <!-- 「这里还可以去」放在最上面：它是**导航**，用户进入某处后
                   最可能想做的事就是「顺着往下逛」，属于入口而非页尾补充信息。
                   纯文字 chip 要用户靠名字猜，有图时才摆缩略图。 -->
              <div v-if="children.length" class="scene-children">
                <div class="scene-children-head">这里还可以去（{{ children.length }}）</div>
                <div class="scene-children-list">
                  <!-- 整卡热区（图 + 名）不套 LinsheButton：按 AGENTS.md 第 4 条用
                       div[role=button]，自包含样式并补齐键盘可达。 -->
                  <div
                    v-for="c in children"
                    :key="c.id"
                    role="button"
                    tabindex="0"
                    class="scene-child"
                    :class="{ 'has-thumb': c.imageUrl }"
                    @click="jump(c.id)"
                    @keydown.enter.prevent="jump(c.id)"
                    @keydown.space.prevent="jump(c.id)"
                  >
                    <img v-if="c.imageUrl" class="scene-child-thumb" :src="c.imageUrl" alt="" loading="lazy" />
                    <span class="scene-child-name">{{ c.name }}</span>
                  </div>
                </div>
              </div>

              <p v-if="current.summary" class="scene-summary">{{ current.summary }}</p>
              <p v-else class="scene-summary empty">这处还没有写简介。</p>

              <!-- 配图：**初始不带图**（200 多处全量预生成既慢又浪费），点一次才生一张并进相册 -->
              <div v-if="current.imageUrl" class="scene-photo">
                <img class="scene-photo-img" :src="current.imageUrl" :alt="`${current.name} 的画面`" loading="lazy" @click="lightboxOpen = true" />
                <div class="scene-photo-bar">
                  <span class="scene-photo-hint">点图可放大 · 重新生成不会删掉旧图，旧图留在相册里</span>
                  <linshe-button size="sm" variant="ghost" :loading="generating" @click="generateImage">重新生成</linshe-button>
                </div>
              </div>
              <div v-else class="scene-photo empty">
                <linshe-button size="sm" variant="primary" :loading="generating" @click="generateImage">
                  {{ generating ? '正在生成…' : '✨ 生成配图' }}
                </linshe-button>
                <span class="scene-photo-hint">
                  {{ generating ? '提示词准备 + 出图，通常 10–60 秒' : '这处还没有配图。点一下生成一张，自动收进相册的「场景」分类。' }}
                </span>
              </div>

              <details v-if="current.scenePrompt" class="scene-prompt">
                <summary>画面描述（英文生图提示词）</summary>
                <p>{{ current.scenePrompt }}</p>
              </details>

              <div class="scene-meta">
                <span v-if="current.kind" class="scene-chip">{{ current.kind }}</span>
                <span v-if="current.category" class="scene-chip">{{ current.category }}</span>
                <span v-if="current.openAt" class="scene-chip">{{ current.openAt }}–{{ current.closeAt || '…' }}</span>
                <span v-if="current.access === 'restricted'" class="scene-chip warn">受限进入</span>
                <span v-if="current.access === 'private'" class="scene-chip warn">私人空间</span>
              </div>
            </div>
          </article>
          <div v-else class="scene-stage scene-empty" role="status">
            <p>{{ loading ? '正在载入场景…' : '没有可展示的场景。' }}</p>
          </div>
        </Transition>

        <div class="scene-nav">
          <!-- 顺序翻看保留成一对轻量箭头，但**去掉「13 / 207」这种幻灯计数器**：
               现在左栏清单和缩略图网格已经回答了「我在全局的哪儿」，
               再摆一个页码等于把「一次一张幻灯」的心智模型又请回来。 -->
          <linshe-button size="sm" variant="ghost" :disabled="!hasPrev" title="上一处（←）" @click="step(-1)">←</linshe-button>
          <linshe-button size="sm" variant="ghost" :disabled="!hasNext" title="下一处（→）" @click="step(1)">→</linshe-button>
          <linshe-button size="sm" variant="ghost" @click="pickRandom">随机看一处</linshe-button>
          <linshe-button v-if="isMobile" size="sm" variant="ghost" @click="listOpen = true">场景清单</linshe-button>
        </div>
      </section>
    </div>

    <!-- 移动端：清单作为抽屉，避免 320px 窄栏把详情挤没 -->
    <linshe-modal v-model="listOpen" title="场景清单" class="scene-list-modal">
      <SceneListPanel :items="list" :active-id="current ? current.id : 0" @select="jump" />
    </linshe-modal>

    <!-- 修正：与地图页同一套弹窗（图/文两模）。区别在**应用即落库** ——
         展示页没有编辑表单，草稿没处安放，所以把「保存」这一步交给这个按钮。 -->
    <PlaceRefineModal
      v-model="refineOpen"
      :place-id="refineTarget ? refineTarget.id : null"
      :place-name="refineTarget ? refineTarget.name : ''"
      :character-id="null"
      apply-text="应用并保存"
      apply-hint="展示页没有编辑表单：应用后直接写进地图数据"
      @applied="onRefined"
    />

    <ImageLightbox
      :visible="lightboxOpen"
      :imgs="lightboxImgs"
      :index="0"
      :show-regenerate="false"
      :show-upscale="false"
      :show-delete="false"
      @hide="lightboxOpen = false"
    />

    <Sidebar v-if="sidebarReady && isMobile" :is-mobile="true" :mobile-open="mobileSidebarOpen" @char-selected="mobileSidebarOpen = false" />
  </main>
</template>

<script setup>
import { ref, computed, inject, onMounted, onBeforeUnmount } from 'vue'
import LinsheButton from '../components/ui/LinsheButton.vue'
import LinsheModal from '../components/ui/LinsheModal.vue'
import ImageLightbox from '../components/ImageLightbox.vue'
import SceneListPanel from '../components/scene/SceneListPanel.vue'
import PlaceRefineModal from '../components/worldmap/PlaceRefineModal.vue'
import Sidebar from '../components/Sidebar.vue'
import { getWorldMap, generateWorldMapPlaceImage, updateWorldMapPlace } from '../api/index.js'
import { createMobileSidebarBackHandler } from '../utils/mobileSidebarBack.js'

const toast = inject('toast', null)

const MAP_ID = 11
const list = ref([])
const index = ref(0)
const loading = ref(true)
const mobileSidebarOpen = ref(false)
const sidebarReady = ref(false)
const isMobile = ref(false)
// 配图（一键生图 / 放大）
const generating = ref(false)
const lightboxOpen = ref(false)
// 修正弹窗：refineTarget 是**当前这一处**的快照，弹窗开着时用户还能翻页，
// 所以应用结果必须写回 target，不能写回"此刻的 current"。
const refineOpen = ref(false)
const refineTarget = ref(null)
// 移动端清单抽屉
const listOpen = ref(false)

const current = computed(() => list.value[index.value] || null)
const hasPrev = computed(() => index.value > 0)
const hasNext = computed(() => index.value < list.value.length - 1)
/** 灯箱只放当前这一处的配图（多图轮播留给相册页） */
const lightboxImgs = computed(() => (current.value?.imageUrl ? [current.value.imageUrl] : []))

// 「这里还可以去」只列直属下级：展示页是逐个地点看，不是地图，
// 列全部子孙会把一棵子树塞满屏幕。带上缩略图，有图才显图。
const children = computed(() => (current.value?.children || []).map(c => {
  const hit = list.value.find(p => p.id === c.id)
  return { ...c, imageUrl: hit?.imageUrl || '' }
}))

function jump(id) {
  const i = list.value.findIndex(p => p.id === Number(id))
  if (i >= 0) {
    index.value = i
    syncHash()
  }
  listOpen.value = false
}

function step(delta) {
  const next = index.value + delta
  if (next >= 0 && next < list.value.length) index.value = next
  syncHash()
}

function pickRandom() {
  if (list.value.length < 2) return
  let i = index.value
  while (i === index.value) i = Math.floor(Math.random() * list.value.length)
  index.value = i
  syncHash()
}

/**
 * 一键生图：**初始不带图**，用户点一次才生一张（用户口径：减少负担）。
 * 提示词（优先取库里已确认的 scene_prompt）、出图、落盘、写回 image_url 全在后端；
 * 前端只做三件事：锁住按钮、把新图换到当前卡片上、告诉用户图在哪。
 *
 * ⚠ 不重新 load() 整张地图：那会把浏览位置重置回第一处，而用户只是想要一张图。
 */
async function generateImage() {
  const cur = current.value
  if (!cur || generating.value) return
  generating.value = true
  try {
    const res = await generateWorldMapPlaceImage(cur.id)
    const url = res?.url || ''
    if (!url) throw new Error('没有拿到图片地址')
    cur.imageUrl = url
    if (res.scenePrompt) cur.scenePrompt = res.scenePrompt
    toast?.('配图已生成，收进相册的「场景」分类', 'success')
  } catch (err) {
    console.error('[scene-display] 生成配图失败', err)
    toast?.(err?.message || '生成配图失败，请稍后重试', 'error')
  } finally {
    generating.value = false
  }
}

function openRefine() {
  if (!current.value) return
  refineTarget.value = current.value
  refineOpen.value = true
}

/**
 * 修正弹窗回填：patch 只含**非空**字段（组件契约），逐字段判空再写。
 * 与地图页 onPlaceRefined 同一口径，唯一区别是这里**应用即落库** ——
 * 展示页没有编辑表单，草稿没处安放。
 */
async function onRefined(patch = {}) {
  const target = refineTarget.value
  if (!target) return
  const body = {}
  if (patch.kind) body.kind = patch.kind
  if (patch.summary) body.summary = patch.summary
  if (patch.scenePrompt) body.scene_prompt = patch.scenePrompt
  if (!Object.keys(body).length) return
  try {
    const res = await updateWorldMapPlace(target.id, body)
    const place = res?.place
    if (place) {
      // 用后端回传的行刷新（服务端还会 clamp / 归一化，本地草稿不是最终值）
      target.kind = place.kind || ''
      target.summary = place.summary || ''
      target.scenePrompt = place.scene_prompt || ''
    }
    toast?.('已写进地图数据', 'success')
  } catch (err) {
    console.error('[scene-display] 保存修正失败', err)
    toast?.(err?.message || '保存失败，请重试', 'error')
  }
}

/** 把当前场景写进地址栏（#/scenes?place=<id>），刷新后能停在原处 */
function syncHash() {
  const cur = current.value
  if (!cur) return
  const base = window.location.hash.split('?')[0]
  const next = `${base}?place=${cur.id}`
  if (window.location.hash !== next) window.history.replaceState(null, '', next)
}

/**
 * 把后端返回的地点树摊平成「一次看一处」的列表。
 *
 * ── 为什么在前端摊平而不加后端接口 ──────────────────────
 * `GET /worldmap/maps/11` 一次就返回全图（193 地点，无分页），
 * 展示页需要的 name/summary/scene_prompt/kind/category/access/open_at
 * 与父链**全都在返回体里**。再开一个「场景展示专用」接口
 * 只会多一份要同步维护的查询，属于画蛇添足。
 *
 * ── 路径文本是真父链，不是猜的 ──────────────────────────
 * pathText 由 parent_id 逐级上溯拼出（如「二相乐园之外 · 仙舟罗浮 · 长乐天 · 若木亭」），
 * 与 `agent-core/src/services/adventure/spaceTree.js` 的 chainOf 同口径。
 * 不写死任何前缀 —— 地图改结构时这里自动跟着变。
 *
 * ── areaKey/placeKey 用于筛选，取的是**真实祖先**而非字符串切分 ──
 * 顶层（L1）作区域、其下第一个节点作「地点」。
 * 之所以不用「·」切名字：地名本身可能含「·」，切字符串会把名字切坏。
 */
function flattenTree(tree) {
  const out = []
  const walk = (nodes, parentChain) => {
    for (const n of nodes || []) {
      const chain = [...parentChain, n]
      // 叶子之外也收：场馆本身（如「长乐天」）也是可展示的场景，
      // 只是它的 children 会变成「这里还可以去」。
      out.push({
        id: Number(n.id),
        name: n.name,
        summary: n.summary || '',
        scenePrompt: n.scene_prompt || '',
        // 地点配图（可能为空串 = 还没生成过）；生成后由 generateImage 就地回写
        imageUrl: n.image_url || '',
        kind: n.kind || '',
        category: n.category || '',
        access: n.access || '',
        openAt: n.open_at || '',
        closeAt: n.close_at || '',
        pathText: chain.length > 1
          ? chain.slice(0, -1).map(c => c.name).join(' · ')
          : '世界地图顶层区域',
        areaKey: chain[0] ? String(chain[0].id) : '',
        areaName: chain[0] ? chain[0].name : '',
        placeKey: chain[1] ? String(chain[1].id) : '',
        placeName: chain[1] ? chain[1].name : '',
        // ── 树的形状：清单要按层级折叠，所以得知道自己在第几层、父节点是谁 ──
        // 同样取真实祖先而不是切 pathText：地名里可能含「·」，切字符串会把层级切错。
        depth: chain.length,
        parentId: chain.length > 1 ? Number(chain[chain.length - 2].id) : 0,
        children: (n.children || []).map(c => ({ id: Number(c.id), name: c.name })),
      })
      if (n.children?.length) walk(n.children, chain)
    }
  }
  walk(tree || [], [])
  return out
}

async function load() {
  loading.value = true
  try {
    const res = await getWorldMap(MAP_ID)
    // ⚠ 返回体是 `{ map: { tree, places, stats, … } }` —— 树在 `res.map.tree`，
    //   不是 `res.tree`。写错会静默得到空列表（页面显示"没有可展示的场景"）。
    list.value = flattenTree(res?.map?.tree || [])
    const wanted = Number(new URLSearchParams(window.location.hash.split('?')[1] || '').get('place') || 0)
    const i = wanted ? list.value.findIndex(p => p.id === wanted) : -1
    index.value = i >= 0 ? i : 0
  } catch (err) {
    console.error('[scene-display] 载入失败', err)
    list.value = []
  } finally {
    loading.value = false
  }
}

/**
 * 快捷键只在桌面生效，且不能和清单里正在编辑的输入框抢键。
 * 移动端没有物理方向键，且抽屉开着时方向键语义会打架。
 */
function isTypingTarget(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function onKey(e) {
  if (isMobile.value) return
  if (e.key === 'Escape' && listOpen.value) { listOpen.value = false; return }
  if (isTypingTarget(e.target)) return
  if (e.key === 'ArrowLeft' || e.key === 'k' || e.key === 'K') { step(-1); e.preventDefault() }
  else if (e.key === 'ArrowRight' || e.key === 'j' || e.key === 'J') { step(1); e.preventDefault() }
  else if (e.key === 'r' || e.key === 'R') { pickRandom(); e.preventDefault() }
}

let disposeBack = null
let disposeViewport = null

onMounted(async () => {
  const mq = window.matchMedia('(max-width: 768px)')
  isMobile.value = mq.matches
  // 视口跨过断点（旋转屏幕 / 缩放窗口）时布局要在两种形态间切换，靠一次性取值会卡在旧形态
  const onViewport = () => { isMobile.value = mq.matches }
  mq.addEventListener('change', onViewport)
  disposeViewport = () => mq.removeEventListener('change', onViewport)
  sidebarReady.value = true
  // ⚠ 该工具要求 { isMobile, isOpen, open } 三个**函数**（与 StandingDisplayView 同口径）。
  //   原来传的 `open: mobileSidebarOpen` 是个 ref，且漏了 isOpen —— 移动端返回键实际是坏的。
  disposeBack = createMobileSidebarBackHandler({
    isMobile: () => isMobile.value,
    isOpen: () => mobileSidebarOpen.value,
    open: () => { mobileSidebarOpen.value = true },
  })
  window.addEventListener('keydown', onKey)
  await load()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (typeof disposeBack === 'function') disposeBack()
  if (typeof disposeViewport === 'function') disposeViewport()
})
</script>

<style scoped>
.scene-display { position: relative; min-height: 100%; padding: 24px; }
.scene-layout { display: flex; align-items: flex-start; gap: 20px; }
.scene-detail { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.scene-stage { position: relative; display: flex; flex-direction: column; }
.scene-empty { justify-content: center; color: var(--text-secondary); padding: 60px 0; }
.scene-body { width: 100%; border: 1px solid var(--border); border-radius: var(--radius-lg, 14px); background: var(--bg-secondary); padding: 22px 24px; display: flex; flex-direction: column; gap: 14px; }
.scene-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
/* 地点名原本飘在一个手绘云朵气泡里，纯装饰且吃掉一整块首屏高度；
   名字本身是必要信息，改成正常的标题排版留在原位。 */
.scene-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.scene-name { margin: 0; font-size: var(--fs-xl, 1.35rem); font-weight: 700; color: var(--text-bright); }
.scene-path { margin: 0; color: var(--text-secondary); font-size: var(--fs-sm); }
.scene-summary { margin: 0; line-height: 1.85; white-space: pre-wrap; }
.scene-summary.empty { color: var(--text-secondary); font-style: italic; }
/* 配图区：没图时只是一个按钮 + 一行说明，不摆空框（"初始不带图"就别先占一块地方） */
.scene-photo { display: flex; flex-direction: column; gap: 10px; }
.scene-photo.empty { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px; border: 1px dashed var(--border); border-radius: var(--radius-md, 10px); }
/* 生成图是 1:1 方图。这里曾经是 max-height:420px + object-fit:cover，
   在千像素宽的详情栏里等于把方图上下各裁掉一大片（只看得见中间一条）。
   改 contain + 居中：整幅画面完整可见，留白由容器底色承担，不裁内容。 */
.scene-photo-img {
  width: 100%; max-height: min(72vh, 760px);
  object-fit: contain; display: block;
  background: var(--bg-sunken);
  border: 1px solid var(--border); border-radius: var(--radius-md, 10px);
  cursor: zoom-in;
}
.scene-photo-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.scene-photo-hint { color: var(--text-secondary); font-size: var(--fs-xs, 12px); line-height: 1.6; }
.scene-prompt { border-top: 1px dashed var(--border); padding-top: 10px; }
.scene-prompt summary { cursor: pointer; color: var(--text-secondary); font-size: var(--fs-sm); }
.scene-prompt p { margin: 8px 0 0; color: var(--text-secondary); font-size: var(--fs-sm); line-height: 1.7; overflow-wrap: anywhere; }
.scene-meta { display: flex; flex-wrap: wrap; gap: 8px; }
.scene-chip { display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border: 1px solid var(--border); border-radius: 999px; font-size: var(--fs-xs, 12px); color: var(--text-secondary); }
.scene-chip.warn { border-color: var(--accent-solid); color: var(--accent-on-soft); }
/* 「这里还可以去」是导航入口，挂在标题正下方。
   分隔线走**下边**：它上面是标题栏，不再是页尾区块。 */
.scene-children { padding-bottom: 12px; border-bottom: 1px dashed var(--border); }
.scene-children-head { font-size: var(--fs-sm); color: var(--text-secondary); margin-bottom: 8px; }
.scene-children-list { display: flex; flex-wrap: wrap; gap: 8px; }
/* 缩略图入口属于「整卡热区」类独立设计，按 AGENTS.md 用裸 button + 自包含样式 */
.scene-child {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 4px 12px 4px 6px; border: 1.5px solid var(--border); border-radius: 999px;
  background: var(--bg-secondary); color: var(--text-secondary);
  font-family: inherit; font-size: var(--fs-sm); cursor: pointer;
  transition: border-color .15s ease, transform .15s ease;
}
.scene-child:not(.has-thumb) { padding-left: 12px; }
.scene-child:hover { border-color: var(--border-strong); color: var(--text-bright); transform: translateY(-1px); }
.scene-child:active { transform: translateY(1px); }
.scene-child:focus-visible { outline: 3px solid rgba(var(--accent-rgb), 0.3); outline-offset: 2px; }
.scene-child-thumb { width: 26px; height: 26px; border-radius: 999px; object-fit: cover; display: block; }
.scene-nav { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px; }
.scene-card-enter-active, .scene-card-leave-active { transition: transform .3s var(--ease-out), opacity .3s ease; }
.scene-card-enter-from { transform: translateX(48px); opacity: 0; }
.scene-card-leave-to { transform: translateX(-48px); opacity: 0; }

/* 移动端：清单进抽屉（linshe-modal），详情占满，不再并排挤成一条 */
@media (max-width: 768px) {
  .scene-display { padding: 16px; }
  .scene-body { padding: 18px 16px; }
  .sidebar-shown .scene-display { padding-bottom: 64px; }
}

@media (prefers-reduced-motion: reduce) { .scene-card-enter-active, .scene-card-leave-active { transition: none; } }
</style>