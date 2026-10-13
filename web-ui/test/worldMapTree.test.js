/**
 * 世界地图 · 树的展开记忆 + 「新增地点后整页空白」回归守卫。
 *
 * 这两类都是**用户报过的真 bug**，而且都不报错、只是"页面白掉 / 状态记不住"，光靠构建查不出来。
 *
 * 阶段 3 改造：原先 4 条测试在测试文件里**复刻了一份 flatTree**（测复制品 → 生产逻辑坏了也不会红），
 * 现已改为直接导入 `web-ui/src/utils/worldMapTree.js` 的真实实现；复刻版删除。
 * 其余 8 条是 source-audit（读源码查模板/接线不变量）——本仓库没有组件挂载设施（无 jsdom/Vitest），
 * 这类模板结构断言只能读源码，故保留原处并标注。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { flattenVisibleTree, flattenFullTree, expandedFromMemory } from '../src/utils/worldMapTree.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(__dirname, '../src')
const viewSrc = fs.readFileSync(path.join(SRC, 'views/WorldMapView.vue'), 'utf8')
const pointSrc = fs.readFileSync(path.join(SRC, 'components/worldmap/MapPointView.vue'), 'utf8')

const TREE = [{
  id: 1, name: '星穹列车', children: [
    { id: 2, name: '派对车厢', children: [{ id: 3, name: '星的房间', children: [] }] },
    { id: 4, name: '观景车厢', children: [] },
  ],
}]

// ── 真·生产逻辑（导入实现，不是复刻） ──────────────────────

test('flattenVisibleTree 展开集合为空时只剩顶层', () => {
  const flat = flattenVisibleTree(TREE, new Set())
  assert.deepEqual(flat.map(n => n.name), ['星穹列车'])
  assert.deepEqual(flat.map(n => n._depth), [0], '_depth 用于缩进，顶层应为 0')
})

test('flattenVisibleTree 逐层展开', () => {
  assert.deepEqual(flattenVisibleTree(TREE, new Set([1])).map(n => n.name),
    ['星穹列车', '派对车厢', '观景车厢'])
  assert.deepEqual(flattenVisibleTree(TREE, new Set([1, 2])).map(n => n.name),
    ['星穹列车', '派对车厢', '星的房间', '观景车厢'])
  // 没展开父级时，只给子级 id 也不该漏出子树（默认全折叠语义）
  assert.deepEqual(flattenVisibleTree(TREE, new Set([2])).map(n => n.name), ['星穹列车'])
})

test('flattenVisibleTree 深度正确且不改原树', () => {
  const flat = flattenVisibleTree(TREE, new Set([1, 2]))
  assert.deepEqual(flat.map(n => n._depth), [0, 1, 2, 1])
  assert.equal(TREE[0].children[0]._depth, undefined, '不得把 _depth 写回原树')
})

test('flattenFullTree 忽略折叠返回全量', () => {
  assert.deepEqual(flattenFullTree(TREE).map(n => n.name),
    ['星穹列车', '派对车厢', '星的房间', '观景车厢'])
  assert.deepEqual(flattenFullTree(TREE).map(n => n._depth), [0, 1, 2, 1])
  assert.deepEqual(flattenFullTree(null), [], '空树不得抛错')
})

test('expandedFromMemory 过滤脏数据', () => {
  assert.deepEqual([...expandedFromMemory({ 11: [1, 'x', null, 7] }, 11)], [1, 7],
    '非数字项要丢弃（脏项会让 expanded.has 恒不命中）')
  assert.deepEqual([...expandedFromMemory({ 11: 'nope' }, 11)], [], '非数组一律当空')
  assert.deepEqual([...expandedFromMemory(null, 11)], [], '整份记忆缺失时返回空集')
})

test('expandedFromMemory 逐图独立', () => {
  const all = { 11: [1, 2], 12: [9] }
  assert.deepEqual([...expandedFromMemory(all, 11)], [1, 2])
  assert.deepEqual([...expandedFromMemory(all, 12)], [9], '不同地图各记各的')
  assert.deepEqual([...expandedFromMemory(all, 99)], [], '没记录过的图 → 默认全折叠')
})

// ── source-audit（读源码查模板/接线不变量，见文件头说明） ──

test('View 树逻辑必须委托唯一真源', () => {
  const codeOnly = viewSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  // `collapsed` 作为**变量**不该再出现（语义会反向：默认全展开）
  assert.ok(!/\bcollapsed\.value\b/.test(codeOnly), '仍有 collapsed.value 残留 —— 语义会反向')
  // 必须用 utils 里的唯一真源，而不是又在 View 里抄一份 walk（这正是阶段 3 修掉的 E 类问题）
  assert.match(codeOnly, /const flatTree = computed\(\(\) => flattenVisibleTree\(/, 'flatTree 应委托 flattenVisibleTree')
  assert.match(codeOnly, /const fullFlat = computed\(\(\) => flattenFullTree\(/, 'fullFlat 应委托 flattenFullTree')
})

test('展开状态要落盘并在换图时读回', () => {
  assert.match(viewSrc, /linshe\.worldmap\.expanded/, '缺 localStorage 键')
  assert.match(viewSrc, /function saveExpanded/, '缺落盘函数')
  assert.match(viewSrc, /function loadExpanded/, '缺读回函数')
  assert.match(viewSrc, /expanded\.value = loadExpanded\(id\)/, '换图要读回展开状态')
  // 每次切换展开/折叠都要保存
  assert.match(viewSrc, /function toggleCollapse[\s\S]{0,300}saveExpanded\(\)/, 'toggleCollapse 没落盘')
  assert.match(viewSrc, /async function loadMap[\s\S]{0,300}loadExpanded\(id\)/, 'loadMap 没读回展开状态')
})

test('空白页根因 不得再用 selected.children.length', () => {
  // 后端 `places` 扁平行**没有 children 键** → 一旦 selected 是扁平行就抛错 → 整页白掉。
  // 统一走 selChildren / selPois（永远返回数组）。
  // 只查**代码**：注释里为说明"为什么不用它"会提到该写法，不该算违规。
  const codeNoComments = viewSrc.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  assert.ok(!/selected\.children\.length/.test(codeNoComments),
    '仍有 selected.children.length —— 扁平行会让整页渲染失败')
  assert.ok(!/selected\.pois\.length/.test(codeNoComments),
    '仍有 selected.pois.length —— 同上')
  assert.match(viewSrc, /const selChildren = computed\(\(\) => selected\.value\?\.children \|\| \[\]\)/)
  assert.match(viewSrc, /const selPois = computed\(\(\) => selected\.value\?\.pois \|\| \[\]\)/)
})

test('ensureNodeShape 存在且选中/刷新都过它', () => {
  assert.match(viewSrc, /function ensureNodeShape/, '缺 ensureNodeShape')
  // selectPlace 有第二参 opts（={} 时跳过未保存确认），旧正则写死 `(p)` 会误报
  assert.match(viewSrc, /function selectPlace\(p[,)][\s\S]{0,300}ensureNodeShape\(p\)/,
    'selectPlace 应保证选中项形状')
  assert.match(viewSrc, /function refreshSelected[\s\S]{0,900}ensureNodeShape\(node\)/,
    'refreshSelected 应保证选中项形状')
})

test('新增地点必须是弹窗不得用原生 prompt', () => {
  assert.ok(!/\bprompt\(/.test(viewSrc.replace(/\/\*[\s\S]*?\*\//g, '')),
    '仍在用原生 prompt() —— 用户口径要弹窗式')
  assert.match(viewSrc, /const addPlaceOpen = ref\(false\)/)
  assert.match(viewSrc, /async function onSaveAdd/)
  assert.match(viewSrc, /function onAddChild\(parent\)[\s\S]{0,400}addPlaceOpen\.value = true/,
    'onAddChild 应打开弹窗而不是直接建')
})

test('编辑弹窗可改上级且候选剔除自己与子孙', () => {
  assert.match(viewSrc, /const editPlace = reactive\(\{[^}]*parentId:/, 'editPlace 缺 parentId')
  assert.match(viewSrc, /const parentOptions = computed/, '缺上级候选')
  assert.match(viewSrc, /descendantIds/, '缺子孙收集（防成环）')
  assert.match(viewSrc, /parentId: editPlace\.parentId === '' \? null : Number\(editPlace\.parentId\)/,
    '保存时应把上级作为移动参数传出去')
})

test('点位图全域 按大区通用渲染', () => {
  assert.match(pointSrc, /const overview = computed/, '缺通用全域布局')
  assert.match(pointSrc, /type: 'cars'/, '缺车厢条分块')
  assert.match(pointSrc, /type: 'plain'/, '缺通用面板分块（其他大区不能被隐藏）')
  // 画布高必须跟着块数走（别用 `[^)]*`：`computed(() => …)` 的箭头函数括号会截断）
  assert.match(pointSrc, /viewBox = computed\([\s\S]{0,160}overview\.value\.height/,
    'viewBox 高度应来自布局计算（写死会让新块溢出画布）')
  assert.ok(!/const wings = computed/.test(pointSrc), '旧的 wings 硬编码应已移除')
  assert.ok(!/const orphans = computed/.test(pointSrc), '孤儿兜底应已被 plain 分块取代')
})

test('点位图全域 车厢内地点可点选', () => {
  assert.match(pointSrc, /car\.kids/, '车厢应渲染内部地点')
  assert.match(pointSrc, /@click\.stop="pick\(k\)"/, '车内地点应可点选')
  assert.match(pointSrc, /TRAIN_ROOT/, '车厢条应只对星穹列车生效')
})
