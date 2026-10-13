/**
 * WorldMapView 一站式地点编辑（常驻表单）—— 回归测试。
 *
 * 用户口径（2026-10-07）：
 *   「我的期望是一站式、一页式进行人工编辑工作……你的『编辑』和『取消』本质上就是
 *     折叠当前地点的详细编辑区块，功能位置发生变化，非常反人类。」
 *
 * 病根：此前是**两态切换**（浏览态按钮「编辑/修正/删除」↔ 编辑态按钮「修正/取消/保存」），
 * 而「编辑」「取消」只是折叠开关。按钮换位置换组合，用户每次要重新找。
 *
 * 守四件事：① 不得再有第二态；② 选中即灌表单；③ 保存/撤销位置固定且一次提交；
 * ④ 未保存改动必须显式可见。
 *
 * 阶段 3 说明（2026-10-09）：本文件 16 条**全部是 source-audit**——守的是 Vue 模板结构、
 * 按钮顺序、事件绑定这类不变量，而本仓库没有组件挂载设施（无 jsdom / @vue/test-utils），
 * 所以只能读源码断言。已清掉 ★ 装饰、标题改为 `<被测接口> <动作> <预期>`。
 * 其中「标脏」一条的**事件名拼写**已放宽为 kebab/camel 都认 —— 这样 eslint 的
 * `vue/v-on-event-hyphenation` 规则（会把 `@update:modelValue` 改成 kebab）不再与它冲突。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC = path.resolve(__dirname, '../../web-ui/src');
const view = fs.readFileSync(path.join(WEB_SRC, 'views/WorldMapView.vue'), 'utf8');
const pointSrc = fs.readFileSync(path.join(WEB_SRC, 'components/worldmap/MapPointView.vue'), 'utf8');

/** 取某个函数的源码段（边界=下一个顶层函数声明 / 注释块） */
function fnBody(src, name) {
  const re = new RegExp(`(?:export )?(?:async )?function ${name}\\(`);
  const hit = re.exec(src);
  if (!hit) return '';
  const i = hit.index;
  const rest = src.slice(i + 10);
  const m = rest.search(/\n(?:\/\*\*|\/\/ ─|(?:export )?(?:async )?function )/);
  return src.slice(i, m > -1 ? i + 10 + m : i + 4000);
}

// ── ① 不得再有第二态 ──────────────────────────────────────

test('WorldMapView 不得有编辑态开关', () => {
  // 它是两态结构的标志物：有它就必然有"进入/退出编辑"两个动作与两套按钮。
  // 必须**同时剥掉块注释**（`/** */`）—— 新代码的注释里会提到它的旧名字作历史说明。
  const code = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\beditingInline\b/.test(code),
    '不应再出现 editingInline —— 表单显隐应只由 selected 决定');
});

test('WorldMapView 不得有「编辑」按钮', () => {
  assert.ok(!/>\s*编辑\s*</.test(view), '「编辑」按钮应已移除（表单常驻，不需要"进入编辑"）');
  // 检查 cancelEdit 时必须**同时剥掉块注释** —— 新函数注释里提了它的旧名字作历史说明
  const code = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\bcancelEdit\b/.test(code), '「取消」应已替换为语义准确的「撤销」(onUndoEdit)');
  assert.match(code, /function onUndoEdit/, '应存在 onUndoEdit（撤销）');
});

test('地点表单必须常驻渲染', () => {
  // 地点表单容器：不可再有 v-if 开关；它现在无条件渲染
  const m = view.match(/<!-- ── 地点信息（常驻表单）── -->[\s\S]{0,220}/);
  assert.ok(m, '应有"常驻表单"区块');
  assert.ok(!/v-if=/.test(m[0]), '常驻表单不得带 v-if —— 那等于把两态带回来');
  // 且不再有 v-if="!editingInline" 这类反向折叠
  assert.ok(!/v-if="!editingInline"/.test(view), '不该再有 editingInline 反向条件');
});

// ── ② 选中即灌表单 ────────────────────────────────────────

test('selectPlace 选中即灌表单', () => {
  const fn = fnBody(view, 'selectPlace');
  assert.ok(fn.length > 100, '应能截出 selectPlace');
  assert.match(fn, /openEdit\(/, '选中后必须调用 openEdit 灌表单');
  // 不得再有"按模式决定是否编辑"的分支（那是两态的残留）
  assert.ok(!/opts\.edit/.test(fn), '不应再按 opts.edit 区分 —— 选中即编辑');
});

test('selectPlace 有未保存改动时先确认', () => {
  const fn = fnBody(view, 'selectPlace');
  assert.match(fn, /editDirty/, '应检查未保存改动');
  assert.match(fn, /confirm\(/, '有改动时必须让用户确认');
  assert.match(fn, /return false/, '用户选"取消"时必须中止切换（返回 false 供调用方判断）');
});

test('onNodeClick 尊重取消切换', () => {
  const fn = fnBody(view, 'onNodeClick');
  assert.match(fn, /selectPlace\([^)]*\)\s*===\s*false/, '应检查 selectPlace 返回值');
  assert.match(fn, /return/, '取消切换时应提前返回，不再折叠');
});

test('onPlaceRefined 回填不触发未保存确认', () => {
  const fn = fnBody(view, 'onPlaceRefined');
  assert.match(fn, /skipConfirm:\s*true/, '回填应跳过确认');
  assert.match(fn, /editDirty\.value\s*=\s*true/, '回填后应标脏，让「保存」亮起');
});

// ── ③ 保存：位置固定 + 一次提交 ───────────────────────────

test('wd-head-ops 四按钮位置与顺序固定', () => {
  // 顶部操作区应恰好包含这四个，且顺序稳定（这正是用户要的"功能位置不发生变化"）
  const m = view.match(/<div class="wd-head-ops">([\s\S]*?)<\/div>/);
  assert.ok(m, '应有 wd-head-ops 区块');
  const seg = m[1];
  const order = ['修正', '删除', '撤销', '保存'].map(t => seg.indexOf(`>${t}<`));
  assert.ok(order.every(i => i >= 0), `四个按钮都应存在（实际顺序位置 ${order.join(',')}）`);
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], '按钮顺序必须稳定（位置不变是本次需求的核心）');
  }
  // 不得再有第二个"保存"按钮（曾有个"保存生活地点"独立按钮，位置还会变）。
  // 只在**地点详情区**内统计：「地图设置」弹窗里还有一个「保存」，那是另一个作用域、合理存在。
  const detail = view.slice(view.indexOf('class="wmap-detail"'), view.indexOf('<!-- ── 我的地图列表'));
  const saveCount = (detail.match(/>保存</g) || []).length;
  assert.equal(saveCount, 1, `地点详情区只应有**一个**保存按钮（实际 ${saveCount} 个）`);
});

test('onSaveAll 一次提交地点字段与生活地点', () => {
  const fn = fnBody(view, 'onSaveAll');
  assert.ok(fn.length > 300, '应能截出 onSaveAll');
  assert.match(fn, /updateWorldMapPlace/, '应调更新接口');
  assert.match(fn, /pois/, '必须一并提交生活地点');
  assert.match(fn, /editDirty/, '应处理字段改动标记');
  assert.match(fn, /poisDirty/, '应处理生活地点改动标记');
});

test('savePois 不得复活', () => {
  const code = view.replace(/\/\/[^\n]*/g, '');
  assert.ok(!/function savePois\b/.test(code), 'savePois 应已删除，并入 onSaveAll');
  assert.ok(!/savePois\(/.test(code), '不应再有对 savePois 的调用');
});

test('onUndoEdit 恢复库中已保存值', () => {
  const fn = fnBody(view, 'onUndoEdit');
  assert.ok(fn.length > 80, '应能截出 onUndoEdit');
  assert.match(fn, /openEdit\(/, '应从库里数据重新灌一遍');
  assert.match(fn, /fullFlat|map\.value/, '数据源应是当前地图的最新数据');
  // 不得只把表单清空（那是"清空"不是"撤销"）
  assert.ok(!/editPlace\.name\s*=\s*''/.test(fn), '不该手写清空各字段 —— 那是清空不是撤销');
});

// ── ④ 未保存改动必须显式可见 ──────────────────────────────

test('wd-dirty 未保存徽标与状态存在', () => {
  assert.match(view, /class="wd-dirty"/, '应有未保存徽标');
  assert.match(view, /未保存/, '徽标文字应为「未保存」');
  assert.match(view, /const editDirty = ref\(false\)/, '应有 editDirty 状态');
});

test('地点各字段都要标脏', () => {
  // 地点表单里的输入项：名称/英文名/类型/简介/画面描述/开放关闭时间/上级
  const need = [
    'editPlace.name', 'editPlace.nameEn', 'editPlace.kind',
    'editPlace.summary', 'editPlace.scenePrompt',
    'editPlace.openAt', 'editPlace.closeAt',
  ];
  /**
   * 标脏的写法有**两种**，取决于控件类型：
   *   · 原生 input / textarea → `@input="editDirty = true"`
   *   · `linshe-select`（开放/关闭时间是下拉）→ `@update:model-value="editDirty = true"`
   *     （下拉没有原生 input 事件）
   * 两种都认：Vue 3 的 kebab 与 camel 拼写等价，不该因为 eslint 把事件名规范化成
   * kebab（vue/v-on-event-hyphenation）就把"正确标脏"判成漏标。
   */
  const DIRTY = '@(?:input|update:model-value|update:modelValue)="editDirty = true"';
  const bind = f => {
    const v = f.replace('.', '\\.');
    return new RegExp(`v-model="${v}"[^>]*${DIRTY}|${DIRTY}[^>]*v-model="${v}"`);
  };
  for (const f of need) {
    assert.ok(bind(f).test(view), `${f} 的输入必须标脏 —— 否则改了保存不了`);
  }
  // 准入/分区/上级是点击或下拉，另判（同样两种拼写都认）
  assert.match(view, /editPlace\.access = [^"]*editDirty = true/, '准入切换要标脏');
  assert.match(view, /editPlace\.zone = [^"]*editDirty = true/, '区域性质切换要标脏');
  assert.ok(
    new RegExp(`v-model="editPlace\\.parentId"[^>]*${DIRTY}`).test(view),
    '上级下拉要标脏'
  );
});

test('生活地点各项也要标脏', () => {
  const seg = view.slice(view.indexOf('class="wpoi-row"'), view.indexOf('class="wpoi-foot"'));
  const dirtyCount = (seg.match(/poisDirty = true/g) || []).length;
  assert.ok(dirtyCount >= 3, `生活地点的类型/名称/简介都应标脏（实际 ${dirtyCount} 处）`);
});

test('onGenerateScenePrompt 回填要标脏', () => {
  const fn = fnBody(view, 'onGenerateScenePrompt');
  assert.match(fn, /editDirty\.value = true/, 'AI 回填后应标脏');
});

test('onSaveAll 无改动时禁用保存', () => {
  const m = view.match(/<linshe-button[^>]*@click="onSaveAll"[^>]*>|@click="onSaveAll"[^>]*>/);
  assert.ok(m, '应能定位保存按钮');
  const tag = view.slice(Math.max(0, m.index - 420), m.index + 60);
  assert.match(tag, /:disabled="!editDirty/, '保存按钮应在无改动时禁用');
});
