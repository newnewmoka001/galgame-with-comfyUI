/**
 * 世界地图：别名表单一真源与点位登记
 *
 * 来源：`mediaForumAndMapAlias.test.js` 的地图段（2026-10-09 拆分重组；
 * 原文件把地图与论坛混在一起，失败时要靠行号才能分辨是哪一侧）。
 *
 * 均为**静态源码断言**：这几条缺陷的共同点是"运行时静默降级"
 * （别名表悄悄分叉、点位被塞进别的区），不会抛错、也不会让测试变红 —— 只能在源码层面钉住。
 *
 * 判据是"从哪里取数"而不是具体文案：把 SPOT_ALIAS 的**来源**改掉才是真失败。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const WEB_SRC = path.join(ROOT, 'web-ui/src');
const BACK_SRC = path.join(ROOT, 'agent-core/src');
const read = p => fs.readFileSync(p, 'utf8');

test('别名表必须是单一真源 JSON', (t) => {
  const jsonPath = path.join(WEB_SRC, 'data/erxiangAlias.json');
  assert.ok(fs.existsSync(jsonPath), '必须存在 data/erxiangAlias.json（别名唯一真源）');
  const data = JSON.parse(read(jsonPath));
  assert.ok(data.toOfficial && typeof data.toOfficial === 'object', '必须含 toOfficial（本库名→官方名）');
  assert.ok(data.toLocal && typeof data.toLocal === 'object', '必须含 toLocal（官方名→本库名）');

  const vue = read(path.join(WEB_SRC, 'components/worldmap/MapPointView.vue'));
  assert.match(vue, /import aliasData from '\.\.\/\.\.\/data\/erxiangAlias\.json'/,
    '前端必须 import 该 JSON 作为别名来源');
  assert.match(vue, /aliasData\?\.toLocal|aliasData && typeof aliasData\.toLocal/,
    '前端必须从 JSON 派生 SPOT_ALIAS');
  // 不得再有硬编码的别名对象字面量（`const SPOT_ALIAS = { ... }`）
  assert.ok(!/const SPOT_ALIAS = \{\s*\S+\s*:/.test(vue),
    'SPOT_ALIAS 不得再硬编码字面量（应派生自 JSON）');

  // 该工具脚本在**本地工具箱** `邻舍-local/` 内（不进上游仓库）→ 上游环境不存在时跳过这段断言。
  //    （2026-10-07 分区重组：`0-投递箱/` → `20-工作记录/`）
  const pyPath = path.join(ROOT, '邻舍-local/20-工作记录/2026-10-05_二相乐园-地点点位图/regen_coords.py');
  if (!fs.existsSync(pyPath)) return t.skip('本地工具箱不在（上游环境）——跳过工具脚本断言');
  const py = read(pyPath);
  assert.match(py, /erxiangAlias\.json/, '工具脚本也必须读同一份 JSON（不得再硬编码 ALIAS）');
  assert.ok(!/^ALIAS = \{/.test(py.replace(/^\s+/gm, '')), '脚本里不得再有 ALIAS 字面量');
});

test('改归属端点区分显式 null 与未传', () => {
  const s = read(path.join(BACK_SRC, 'routes/worldMap.js'));
  assert.match(s, /router\.patch\('\/places\/:placeId\/move'/, '必须有 move 端点');
  // 必须用 `in` 判断字段存在性 —— `||` 会把显式 null（移到顶层）与未传混为一谈
  assert.match(s, /'parentId' in \(req\.body/, '必须用 in 判断 parentId 是否传入（区分 null 与未传）');
  assert.match(s, /parentId: req\.body\.parentId/, '必须把 parentId 透传给 upsertPlace');
});

test('海原电视塔登记为独立点位且属喜笑区', () => {
  const s = read(path.join(WEB_SRC, 'components/worldmap/MapPointView.vue'));
  assert.match(s, /{ n: '海原电视塔'/, '全域图应登记海原电视塔为独立点位');
  // 它必须出现在喜笑区（REGION_LAYOUT 的喜笑区段），而不是别的区
  const joy = s.slice(s.indexOf('喜笑区:'), s.indexOf('悲泣区:'));
  assert.match(joy, /海原电视塔/, '提级后应属于喜笑区');
});