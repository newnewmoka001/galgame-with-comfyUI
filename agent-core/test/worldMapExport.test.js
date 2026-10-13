/**
 * 世界地图导出：任意层级与任意层的生活地点
 *
 * 来源：`local-patch-regression.test.js` 的地图段（2026-10-09 拆分重组）。
 *
 * 守的坑：导出原先硬编码三层循环 —— 第 4、5 层会被静默丢掉，
 * 挂在**子地区**上的生活地点（该节点本身是条街/市集、没有下级）也会丢。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { getDb } from '../src/db/index.js';
import {
  createMap, addPlace, upsertPlace, deletePlace, deleteMap, exportMarkdown,
} from '../src/services/worldMapService.js';

test('exportMarkdown 支持任意层级并导出非叶节点的生活地点', () => {
  const mid = createMap({ name: '__zz_regress_map', note: '回归测试' }).id;
  try {
    const l1 = addPlace(mid, { name: '一级' });
    const l2 = addPlace(mid, { parentId: l1.place.id, name: '二级' });
    const l3 = addPlace(mid, { parentId: l2.place.id, name: '三级' });
    const l4 = addPlace(mid, { parentId: l3.place.id, name: '四级' });
    addPlace(mid, { parentId: l4.place.id, name: '五级' });
    // 生活地点挂在**子地区**上（该节点本身是条街/市集，没有下级）——
    // 这正是原先硬编码三层循环时会被丢掉的情形
    upsertPlace(l2.place.id, { pois: [{ name: '续命一刻', type: '餐饮', blurb: '早八咖啡' }] });

    const md = exportMarkdown(mid);
    assert.ok(md.includes('一级') && md.includes('二级') && md.includes('三级'), '前三层应导出');
    assert.ok(md.includes('四级') && md.includes('五级'), '第 4、5 层也应导出（原为硬编码三层，会丢）');
    assert.ok(md.includes('续命一刻'), '子地区自己的生活地点应导出（原会丢）');

    // 删除父节点应级联删掉整棵子树
    deletePlace(l1.place.id);
    assert.equal(getDb().prepare('SELECT COUNT(*) n FROM world_map_places WHERE map_id = ?').get(mid).n, 0);
  } finally {
    deleteMap(mid);
  }
});