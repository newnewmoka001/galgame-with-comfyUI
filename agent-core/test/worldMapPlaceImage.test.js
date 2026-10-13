/**
 * 场景页「一键生图」的守卫契约（世界地图地点配图）。
 *
 * 这一份是**真跑**：真 DB（:memory:）+ 真文件落盘，只在 `generate` 注入点上打桩
 * （真生图要 ComfyUI，测试不出网）。「scene_prompt 为空时现场补一条」那条分支
 * 走 LLM，测试里打不了桩，用源码审计守住。
 *
 * 用户口径（2026-10-12）：初始不带图、点一次才生一张、生成后相册里要收录、
 * 重新生成不删旧图。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

process.env.DB_PATH = ':memory:';
process.env.IMAGES_DIR = mkdtempSync(join(tmpdir(), 'place-scene-'));
globalThis.fetch = async () => { throw new Error('Network forbidden'); };

const {
  createMap, addPlace, getMap, setPlaceImage, generatePlaceImage,
} = await import('../src/services/worldMapService.js');
const { IMAGE_CATEGORIES, getImageDir } = await import('../src/services/imagePaths.js');
const { getDb } = await import('../src/db/index.js');

after(() => rmSync(process.env.IMAGES_DIR, { recursive: true, force: true }));

const PNG = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')}`;
const PROMPT = 'misty campus gate at dawn, glass windows, long shadows';
const SVC = readFileSync(new URL('../src/services/worldMapService.js', import.meta.url), 'utf8');
const DB_SRC = readFileSync(new URL('../src/db/index.js', import.meta.url), 'utf8');
const ROUTES = readFileSync(new URL('../src/routes/worldMap.js', import.meta.url), 'utf8');

/** 从源码里切出一个顶层函数的函数体（下一个顶层声明 / 块注释即止） */
function fnBody(src, name) {
  const m = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!m) return '';
  const rest = src.slice(m.index);
  const end = rest.slice(1).search(/\n(?:export\s|function\s|const\s|let\s|\/\*\*)/);
  return end < 0 ? rest.slice(0, 4000) : rest.slice(0, end + 1);
}

let seq = 0;
/** 造一个带画面描述的地点（parent 可选，用来验证补提示词时取父级名当上下文） */
function makePlace(scenePrompt = PROMPT, parentId = null) {
  seq += 1;
  const map = createMap({ name: `测试地图${seq}` });
  const res = addPlace(map.id, {
    parentId, name: `主楼门厅${seq}`, nameEn: 'Main Hall', kind: '室内',
    summary: '进门先看到的开阔门厅', scenePrompt,
  });
  assert.equal(res.ok, true, '造数据失败，后面的断言都不用看了');
  return { mapId: map.id, place: res.place };
}

test('迁移给 world_map_places 加了 image_url，且 mapPlaceRow 透出它', () => {
  const { place } = makePlace();
  assert.equal(place.image_url, '', '新列默认空串（不是 undefined）：前端才能直接判空决定要不要显示「生成配图」');

  const mig = fnBody(DB_SRC, 'migrateWorldMapPlaceImage');
  assert.match(mig, /PRAGMA table_info\(world_map_places\)/, '加列前必须查存在性：老库是 CREATE TABLE IF NOT EXISTS 建的，重复 ALTER 会抛');
  assert.match(mig, /ADD COLUMN image_url/, '配图指针就存在这一列里，名字不能漂');
  assert.match(DB_SRC, /migrateWorldMapPlaceAttrs\(db\);\s*\n\s*migrateWorldMapPlaceImage\(db\);/, 'migrateWorldMapSchema 必须真的调用它，否则老库永远没有这列');
});

test('setPlaceImage 只动 image_url 一列，别顺手改用户的编辑内容', () => {
  const { place } = makePlace();
  const res = setPlaceImage(place.id, '/images/place_scene/x.png');
  assert.equal(res.ok, true);
  assert.equal(res.place.image_url, '/images/place_scene/x.png');

  const row = getDb().prepare('SELECT * FROM world_map_places WHERE id = ?').get(place.id);
  assert.equal(row.kind, '室内', '后台回写配图不该改类型');
  assert.equal(row.summary, '进门先看到的开阔门厅', '后台回写配图不该改简介');
  assert.equal(row.scene_prompt, PROMPT, '后台回写配图不该改画面描述');

  assert.deepEqual(setPlaceImage(999999, '/x.png'), { ok: false, error: '地点不存在' });
});

test('generatePlaceImage：用库里已确认的 scene_prompt 出图 → 落盘 → 写回 → 记账', async () => {
  const { mapId, place } = makePlace();
  const calls = [];
  const generate = async (prompt, opts) => {
    calls.push({ prompt, opts });
    return {
      success: true,
      images: [{ base64: PNG, filename: 'comfy_00001_.png' }],
      promptRefined: `${prompt}, cinematic lighting`,
      wfMode: 'turbo',
    };
  };

  const res = await generatePlaceImage(place.id, { generate });

  assert.equal(calls.length, 1, '用户点一次就出一张，别偷偷成批出图');
  assert.equal(calls[0].prompt, PROMPT, '提示词必须取库里已确认的 scene_prompt，不能另抽一个画面（否则用户改了描述也控制不住出图）');
  const opts = calls[0].opts;
  assert.equal(opts.scene, 'moments', '沿用日报「城市风光」那一档取景口径：提示词知识库按 scene 过滤，新造 scene 键等于自断 RAG');
  assert.equal(opts.priority, undefined, '用户在前台等着看图，不能进低优队列（要等 180 秒静默窗口，体感是卡住了）');
  assert.equal(opts.ragQuery, PROMPT, 'RAG 检索要用同一条画面描述');
  assert.equal(opts.width, 1600);
  assert.equal(opts.height, 1200);

  assert.match(res.url, /^\/images\/place_scene\/place_\d+_\d+_comfy_00001_\.png$/, 'URL 形状要和 /images 静态托管对得上');
  const file = join(getImageDir('place_scene'), basename(res.url));
  assert.equal(existsSync(file), true, '图必须真落盘：相册是扫磁盘的，库里记了指针而文件不在就是死链');
  assert.equal(res.scenePrompt, PROMPT);
  assert.equal(res.refinedPrompt, `${PROMPT}, cinematic lighting`);
  assert.equal(res.wfMode, 'turbo');

  const map = getMap(mapId);
  const saved = map.places.find(p => p.id === place.id);
  assert.equal(saved.image_url, res.url, '库里要指向新图，否则刷新页面图就没了');

  const task = getDb().prepare('SELECT * FROM image_tasks ORDER BY id DESC LIMIT 1').get();
  assert.equal(task.status, 'done');
  assert.equal(task.prompt_original, PROMPT);
  assert.equal(task.prompt_refined, `${PROMPT}, cinematic lighting`, '记账要留下真正送去出图的那条提示词');
  assert.equal(task.resolution, '1600x1200');
  assert.equal(task.workflow_template, 'turbo');
  assert.ok(task.output_paths.includes(res.url), '记账要能反查到这张图');
});

test('重新生成：地点换成新图，旧图留在磁盘上（用户定案 B）', async () => {
  const { place } = makePlace();
  const stub = () => async () => {
    await new Promise(r => setTimeout(r, 5)); // 拉开发号时间，避免同名覆盖把「旧图还在」测成假象
    return { success: true, images: [{ base64: PNG, filename: 'comfy_00002_.png' }], wfMode: 'turbo' };
  };

  const first = await generatePlaceImage(place.id, { generate: stub() });
  const firstFile = join(getImageDir('place_scene'), basename(first.url));
  const second = await generatePlaceImage(place.id, { generate: stub() });

  assert.notEqual(second.url, first.url, '重新生成要出一张新图，否则相册里看不出变化');
  assert.equal(existsSync(firstFile), true, '旧图必须留在相册里（删文件等于悄悄抹掉用户相册内容）');
  assert.equal(existsSync(join(getImageDir('place_scene'), basename(second.url))), true);
  assert.equal(
    getDb().prepare('SELECT image_url FROM world_map_places WHERE id = ?').get(place.id).image_url,
    second.url,
    '地点上的配图换成新的',
  );
});

test('generatePlaceImage：地点不存在是 404；出图失败是 502 且不动已有配图', async () => {
  await assert.rejects(
    () => generatePlaceImage(999999, { generate: async () => { throw new Error('不该被调用'); } }),
    err => err.statusCode === 404 && /地点不存在/.test(err.message),
    '前端要靠 404 区分「地点被删了」和「ComfyUI 没开」',
  );

  const { place } = makePlace();
  const ok = await generatePlaceImage(place.id, {
    generate: async () => ({ success: true, images: [{ base64: PNG, filename: 'a.png' }] }),
  });
  const beforeTasks = getDb().prepare('SELECT COUNT(*) AS n FROM image_tasks').get().n;

  await assert.rejects(
    () => generatePlaceImage(place.id, { generate: async () => ({ success: false, error: 'ComfyUI 未就绪' }) }),
    err => err.statusCode === 502 && /ComfyUI 未就绪/.test(err.message),
    'ComfyUI 没起来是最常见的一种失败，要原样把原因带给用户',
  );

  const row = getDb().prepare('SELECT image_url FROM world_map_places WHERE id = ?').get(place.id);
  assert.equal(row.image_url, ok.url, '生成失败不能把已经有的配图清空');
  assert.equal(existsSync(join(getImageDir('place_scene'), basename(ok.url))), true, '失败也不该删掉旧文件');
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS n FROM image_tasks').get().n,
    beforeTasks,
    '没出图就不该留一行记账（否则相册/任务列表里会多出一条没有产物的记录）',
  );
  // 保险：失败之后这条路仍然是通的（别把 worker 卡在坏状态里）
  const again = await generatePlaceImage(place.id, {
    generate: async () => ({ success: true, images: [{ base64: PNG, filename: 'b.png' }] }),
  });
  assert.ok(again.url.length > 0, '失败之后还能正常出图');
});

test('源码审计：空 scene_prompt 先补一条并落库；失败在写盘之前就抛', () => {
  const body = fnBody(SVC, 'generatePlaceImage');
  assert.ok(body, '找不到 generatePlaceImage 函数体，说明它被改名/搬走了，这条守卫失效');
  assert.match(body, /let scenePrompt = cleanScenePrompt\(cur\.scene_prompt \|\| ''/, '优先用库里已确认的画面描述');
  assert.match(body, /await generateScenePrompt\(\{/, '空的时候才现场补一条');
  assert.match(body, /UPDATE world_map_places SET scene_prompt = \?/, '补出来的画面描述要落库：否则每次重新生成都重抽画面，同一个地方一张一个样');
  assert.match(body, /context: parent\?\.name \|\| ''/, '补提示词要带上父级地区名当上下文');
  assert.match(body, /saveBase64Image\(\s*'place_scene'/, '落盘分类固定为 place_scene（相册的分类 chip 靠它）');
  assert.match(body, /recordCompletedImageTask\(\{/, '出图要会计账');
  assert.match(body, /invalidateGalleryCache\(\)/, '相册列表缓存 30 秒，不主动失效的话用户生完图切过去看不到它');
  assert.ok(
    body.indexOf('!result?.success || !img?.base64') < body.indexOf("saveBase64Image("),
    '失败要在写盘之前抛：不然会给一次失败留下空文件',
  );
  assert.match(body, /\{ statusCode: 502 \}/, '生图失败对前端是 502（服务端依赖没起来）');
});

test('相册收录：place_scene 分类已登记（登记本身就是「进相册」的全部条件）', () => {
  assert.deepEqual(
    IMAGE_CATEGORIES.place_scene,
    { dir: 'place_scene', label: '场景' },
    '相册是扫磁盘的：分类没登记 → 图落在没被扫描的目录里，用户永远看不到；标签还决定相册里那个筛选 chip',
  );
});

test('路由契约：POST /places/:placeId/image 存在且走统一的 fail()', () => {
  assert.match(ROUTES, /router\.post\('\/places\/:placeId\/image'/, '前端打的就是这个地址');
  assert.match(ROUTES, /generatePlaceImage\(Number\(req\.params\.placeId\)\)/, 'placeId 要转成数字再进服务层');
  const route = ROUTES.slice(ROUTES.indexOf("router.post('/places/:placeId/image'"));
  assert.match(route.slice(0, 400), /catch \(err\) \{ fail\(res, err\); \}/, '异常要交给 fail()：它才能把 statusCode 502/404 带给前端');
});
