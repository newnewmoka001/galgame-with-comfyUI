/**
 * 场景页（/scenes）配图与修正弹窗的接线契约。
 *
 * 本仓库没有组件挂载设施（无 jsdom / Vitest），模板与接线只能在源码上断言；
 * 行为逻辑（生图、落库）在 agent-core/test/worldMapPlaceImage.test.js 里真跑。
 * 断言前先剥掉注释：注释里提到的名字不算实现。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const VIEW_RAW = readFileSync(new URL('../src/views/SceneDisplayView.vue', import.meta.url), 'utf8');
const API = readFileSync(new URL('../src/api/index.js', import.meta.url), 'utf8');

function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
const VIEW = strip(VIEW_RAW);
const TEMPLATE = VIEW.slice(VIEW.indexOf('<template>'), VIEW.indexOf('</template>'));
const PANEL = strip(readFileSync(new URL('../src/components/scene/SceneListPanel.vue', import.meta.url), 'utf8'));

/** 切出一个顶层函数体（下一个顶层声明 / 块注释即止） */
function fnBody(src, name) {
  const m = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!m) return '';
  const rest = src.slice(m.index);
  const end = rest.slice(1).search(/\n(?:export\s|async\s+function\s|function\s|const\s|let\s|\/\*\*)/);
  return end < 0 ? rest.slice(0, 4000) : rest.slice(0, end + 1);
}

test('初始不带图：页面不为没图的地点渲染任何占位图', () => {
  // 口径是「初始不带图、点了才生」，不是「全页只有一个 img」——
  // 清单缩略图与「这里还可以去」的圆图都是有图才渲染的真实配图。
  assert.ok(
    TEMPLATE.indexOf('v-if="current.imageUrl"') < TEMPLATE.indexOf('class="scene-photo-img"'),
    '详情配图必须挂在「已经有图」的分支下，否则没图的地点会显示一个破图图标',
  );
  // 每个 <img> 都得带 v-if 守卫或落在有图分支内，不许出现无条件的占位图
  for (const [i, tag] of [...TEMPLATE.matchAll(/<img\b[^>]*>/g)].entries()) {
    assert.match(tag[0], /v-if=|class="scene-photo-img"/, `第 ${i + 1} 个 <img> 没有「有图才显示」的守卫`);
  }
  assert.match(TEMPLATE, /v-else[\s\S]{0,400}生成配图/, '没图的分支上要有一个「生成配图」的入口（点了才生）');
  assert.match(TEMPLATE, /<linshe-button[^>]*variant="primary"[^>]*:loading="generating"/, '生成中是 primary + loading：按钮自己会显示 spinner 并禁用，不需要另写一套');
});

test('一键生图：点了才生、就地换图、不重载整张地图', () => {
  const gen = fnBody(VIEW, 'generateImage');
  assert.ok(gen, '找不到 generateImage，说明它被改名/搬走了，这条守卫失效');
  assert.match(gen, /if \(!cur \|\| generating\.value\) return/, '连点要挡住：一次点击只能出一张图');
  assert.match(gen, /await generateWorldMapPlaceImage\(cur\.id\)/, '生图走新端点（后端负责提示词/出图/落盘/写指针）');
  assert.match(gen, /if \(!url\) throw new Error\('没有拿到图片地址'\)/, '后端没给 URL 时不要静默成功');
  assert.match(gen, /cur\.imageUrl = url/, '就地把图换到当前卡片上');
  assert.match(gen, /cur\.scenePrompt = res\.scenePrompt/, '顺手同步后端补出来的画面描述，折叠块里要看到它');
  assert.ok(!/load\(\)/.test(gen), '生成完不能重新拉整张地图：那会把浏览位置重置回第一处，而用户只是想要一张图');
  assert.match(gen, /finally \{[\s\S]*generating\.value = false/, '无论成败都要解锁按钮，否则失败一次就再也点不动');
  assert.match(gen, /toast\?\.\('配图已生成，收进相册的「场景」分类'/, '要告诉用户图去哪了（相册是扫磁盘的，不说他找不到）');
});

test('生成失败：把后端给的原因原样带给用户', () => {
  const gen = fnBody(VIEW, 'generateImage');
  assert.match(gen, /catch \(err\) \{/, '失败必须被接住：不能让按钮永远转圈');
  assert.match(gen, /toast\?\.\(err\?\.message \|\| '生成配图失败，请稍后重试', 'error'\)/, 'ComfyUI 没启动 / 502 的原因要显示出来，而不是吞掉换成一句「失败」');
  assert.match(gen, /console\.error\('\[scene-display\] 生成配图失败', err\)/, '前端日志留一份，方便排查');
});

test('修正弹窗：复用地图那一套，且应用即落库', () => {
  assert.match(VIEW, /import PlaceRefineModal from '\.\.\/components\/worldmap\/PlaceRefineModal\.vue'/, '必须复用地图的修正弹窗，别在展示页另写一套');
  assert.match(TEMPLATE, /<PlaceRefineModal[\s\S]{0,600}?\/>/, '弹窗要挂在页面上');
  const modal = TEMPLATE.slice(TEMPLATE.indexOf('<PlaceRefineModal'), TEMPLATE.indexOf('<PlaceRefineModal') + 700);
  assert.match(modal, /v-model="refineOpen"/, '开合状态受页面控制');
  assert.match(modal, /:place-id="refineTarget \? refineTarget\.id : null"/, 'PlaceRefineModal 强依赖 placeId（缺了它 run() 会直接拒绝）');
  assert.match(modal, /:character-id="null"/, '展示页不做「从最近图片里挑选」，关掉那段');
  assert.match(modal, /apply-text="应用并保存"/, '展示页没有编辑表单：应用就等于保存，按钮文案要说清楚');
  assert.match(modal, /@applied="onRefined"/, '结果要回本页处理');

  const apply = fnBody(VIEW, 'onRefined');
  assert.ok(apply, '找不到 onRefined');
  assert.match(apply, /if \(patch\.kind\) body\.kind = patch\.kind/, 'patch 只含非空字段：逐字段判空再写，别把用户的旧内容覆盖成空');
  assert.match(apply, /body\.scene_prompt = patch\.scenePrompt/, '前端 camelCase → 后端 snake_case，字段名写错就是静默不生效');
  assert.match(apply, /await updateWorldMapPlace\(target\.id, body\)/, '应用即落库（PUT，只传有值的字段，后端是逐字段可选更新）');
  assert.match(apply, /const place = res\?\.place/, '用后端回传的行回刷：服务端还会 clamp / 归一化，本地草稿不是最终值');
  assert.match(apply, /target\.kind = place\.kind/, '回刷要写回 refineTarget 而不是「此刻的 current」');
  assert.match(apply, /toast\?\.\('已写进地图数据'/, '要让用户知道已经落库了');
});

test('灯箱：复用 ImageLightbox，只放当前这一处，且不给删除入口', () => {
  assert.match(VIEW, /import ImageLightbox from '\.\.\/components\/ImageLightbox\.vue'/, '放大一律复用共享灯箱（AGENTS.md）');
  assert.match(VIEW, /const lightboxImgs = computed\(\(\) => \(current\.value\?\.imageUrl \? \[current\.value\.imageUrl\] : \[\]\)\)/, '灯箱只吃当前这一处的配图');
  const box = TEMPLATE.slice(TEMPLATE.indexOf('<ImageLightbox'), TEMPLATE.indexOf('<ImageLightbox') + 500);
  assert.match(box, /:visible="lightboxOpen"/, '可见性受页面控制');
  assert.match(box, /:imgs="lightboxImgs"/, '图片来自当前卡片');
  assert.match(box, /:show-delete="false"/, '展示页不给删除：删图是相册页的事，这里手滑就是删用户的图');
  assert.match(box, /@hide="lightboxOpen = false"/, '关闭要能回到页面');
});

test('顺手修掉的失效点：弹窗 prop、下拉事件、裸 button', () => {
  assert.ok(!/:open="pickerOpen"/.test(TEMPLATE), 'LinsheModal 没有 open 这个 prop（只认 modelValue/visible），原来那个写法弹窗永远打不开');
  assert.ok(!/width="720px"/.test(TEMPLATE), 'LinsheModal 没有 width，宽度靠 wide/full');
  assert.ok(!/@change="onFilterChange"/.test(TEMPLATE), 'LinsheSelect 只 emit update:modelValue，没有 change 事件');

  const modal = TEMPLATE.slice(TEMPLATE.indexOf('<linshe-modal'), TEMPLATE.indexOf('</linshe-modal>'));
  assert.match(modal, /v-model="listOpen"/, '移动端的场景清单抽屉要受 v-model 控制');
  assert.match(modal, /<SceneListPanel/, '抽屉里放的就是左栏那份清单，不再另写一套列表');
});

test('场景清单：筛选是过滤而不是跳转，且逻辑归 SceneListPanel 独有', () => {
  assert.match(PANEL, /if \(areaKey\.value && p\.areaKey !== areaKey\.value\) return false/, '选区域＝圈定该区域');
  assert.match(PANEL, /if \(placeKey\.value && p\.placeKey !== placeKey\.value\) return false/, '选地点＝在其中再收敛一层');
  assert.match(PANEL, /watch\(areaKey, \(\) => \{ placeKey\.value = '' \}\)/, '换区域时清掉旧的地点选择（候选集变了）');
  // 旧实现的两个 watch 直接改 index 跳走，选完就丢掉筛选态、没法连着挑；
  // 清单把「筛选」和「选中」分开了，所以视图里不该再有这两个 watch。
  assert.ok(!/watch\(areaFilter/.test(VIEW), '筛选 watch 已搬进 SceneListPanel，视图里不该再留一份');
  assert.ok(!/watch\(placeFilter/.test(VIEW), '同上');
  assert.ok(!/jumpToAreaFirst/.test(VIEW), '筛选不再跳转，「跳该区域第一处」随之取消');
  assert.match(VIEW, /function jump\(id\)/, '清单点击仍要能选中并同步地址栏');
});

test('缩略图网格：网格是一等视图，且缺图时不塌成空块', () => {
  assert.match(PANEL, /const view = ref\('list'\)/, '默认列表视图');
  assert.match(PANEL, /variant="chip" :active="view === 'grid'" @click="view = 'grid'"/, '网格要能从视图栏切过去');
  assert.match(PANEL, /variant="chip" :active="view === 'list'" @click="view = 'list'"/, '要能切回列表');
  assert.match(PANEL, /'as-grid': view === 'grid'/, '网格是挂在 list 容器上的视图类');
  assert.match(PANEL, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, '两列且 minmax(0,) 防止长名字撑破列宽');
  // 网格里的配图必须仍是「有图才渲染」，没图的退回首字占位块，
  // 否则网格会出现一排破图或高低不齐的空卡。
  assert.match(PANEL, /<img v-if="item\.imageUrl"[^>]*>[\s\S]{0,200}v-else/, '网格卡片同样要按「有图才渲染」走 else 占位');
  assert.match(PANEL, /\.scene-entry\.grid \.scene-entry-glyph/, '缺图占位块要在网格里显式放大');
  assert.ok(!/<button\b/.test(PANEL), '面板内不得有裸 button（视图切换要用 LinsheButton 的 chip 变体）');
});

test('树形清单：按真实祖先折叠展开，不切 pathText', () => {
  assert.match(PANEL, /const expanded = ref\(new Set\(\)\)/, '展开态要可记录');
  assert.match(PANEL, /view === 'tree'/, '要有树形视图');
  assert.match(PANEL, /role="tree"/, '树要声明 role=tree');
  assert.match(PANEL, /role="treeitem"/, '每个节点是 treeitem');
  assert.match(PANEL, /:aria-expanded="row\.childCount > 0 \? expanded\.has\(row\.item\.id\) : undefined"/, '分支要暴露展开态');
  assert.match(PANEL, /:style="\{ paddingLeft: `\$\{8 \+ row\.depth \* 14\}px` \}"/, '缩进按 depth 渲染层级');
  // 折叠的关键：祖先没展开时该行不得出现
  assert.match(PANEL, /if \(!expanded\.value\.has\(parent\.id\)\) \{ hidden = true; break \}/, '祖先收起时子孙必须隐藏');
  assert.match(PANEL, /parentId/, '挂回祖先链要靠 parentId，不能靠字符串切分');
  assert.ok(!/pathText\.split/.test(PANEL), '地名可能含「·」，不得用 pathText 切层级');
  // 点箭头只开合、不选中；点行才选中
  assert.match(PANEL, /@click\.stop="toggleExpand\(row\.item\.id\)"/, '箭头是独立热区，点它不该顺带选中');
  assert.match(PANEL, /function onTreeRowClick\(row\)[\s\S]{0,200}select\(row\.item\)/, '点行要选中该地点');
  assert.match(PANEL, /function collapseAll\(\)/, '要有全部收起');
  // 默认收起：207 项全摊开等于又变回平铺列表
  assert.match(PANEL, /expanded = ref\(new Set\(\)\)/, '默认全收起');
});

test('视图栏：列表/缩略图/树形三选一，不得覆盖组件皮肤', () => {
  const style = PANEL.slice(PANEL.indexOf('<style'));
  const rule = style.slice(style.indexOf('.scene-panel-views'));
  const body = rule.slice(0, rule.indexOf('}'));
  assert.match(body, /display: flex/, '视图栏只管布局');
  assert.ok(!/background|color:|border:|font-size/.test(body), `AGENTS.md 第 5 条：皮肤改 LinsheButton，页面只调布局（实际：${body.trim()}）`);
});

test('详情首屏：地点名做正常标题，不再飘云朵气泡', () => {
  // 云朵气泡是纯装饰，占掉整块首屏高度；名字本身是必要信息，必须留下。
  assert.ok(!/scene-bubble|thought-cloud|thought-dot|thought-text/.test(VIEW), '气泡的结构与样式都要清干净，不留死代码');
  assert.ok(!/thought-cloud/.test(VIEW), '手绘云朵 svg 已移除');
  assert.match(TEMPLATE, /<h2 class="scene-name">\{\{ current\.name \}\}<\/h2>/, '地点名要作为标题保留在详情里');
  assert.match(TEMPLATE, /class="scene-title"[\s\S]{0,300}scene-path/, '名字与路径同一处标题区，修正按钮仍在右侧');
});

test('「这里还可以去」是导航，排在简介与配图之前', () => {
  const iNav = TEMPLATE.indexOf('这里还可以去');
  const iSummary = TEMPLATE.indexOf('scene-summary');
  const iPhoto = TEMPLATE.indexOf('scene-photo');
  assert.ok(iNav > 0, '导航区块必须存在');
  assert.ok(iNav < iSummary, '导航要排在简介之前（它是入口，不是页尾补充信息）');
  assert.ok(iNav < iPhoto, '导航要排在配图之前，进页面第一眼就能顺着往下逛');
  // 分隔线换到下方：上面现在是标题栏，不再用 border-top
  const style = VIEW.slice(VIEW.indexOf('<style'));
  const rule = style.slice(style.indexOf('.scene-children {'));
  const body = rule.slice(0, rule.indexOf('}'));
  assert.match(body, /border-bottom/, '导航块的分隔线走下方');
  assert.ok(!/border-top/.test(body), '不该再留 border-top：那会在标题下方多出一条线');
});

test('详情配图不得裁切：方图必须完整可见', () => {
  const style = VIEW.slice(VIEW.indexOf('<style'));
  const rule = style.slice(style.indexOf('.scene-photo-img'));
  const body = rule.slice(0, rule.indexOf('}'));
  // 生成图是 1:1。曾在千像素宽的详情栏里配 max-height:420px + object-fit:cover，
  // 等于上下各裁掉一大片（只看得见中间一条）——方图必须整幅显示。
  assert.match(body, /object-fit:\s*contain/, '配图要 contain（完整可见），不能 cover（裁切）');
  assert.ok(!/object-fit:\s*cover/.test(body), '详情大图一旦回到 cover 就会重新裁掉上下');
  assert.ok(!/max-height:\s*\d+px/.test(body), '别再用固定像素上限压扁方图；用 min(72vh, ...) 这类跟随视口的值');
  assert.match(body, /max-height:\s*min\(/, '上限应跟随视口高度，而不是写死一个会把方图裁掉的像素值');
});

test('面板不得覆盖组件皮肤：树形清单的自定义类只管布局', () => {
  const style = PANEL.slice(PANEL.indexOf('<style'));
  const rule = style.slice(style.indexOf('.scene-panel-tree'));
  const body = rule.slice(0, rule.indexOf('}'));
  assert.match(body, /overflow-y: auto/, '树形清单自身滚动');
  const rowRule = style.slice(style.indexOf('.scene-tree-row {'));
  const rowBody = rowRule.slice(0, rowRule.indexOf('}'));
  assert.match(rowBody, /cursor: pointer/, 'AGENTS.md 第 4 条：自包含热区要补齐 cursor');
});

test('移动端返回键：按工具契约传三个函数，而不是把 ref 当 open 传', () => {
  // createMobileSidebarBackHandler 读的是 isMobile() / isOpen() / open()，
  // 原来这里传的是 `open: mobileSidebarOpen`（一个 ref）且漏了 isOpen —— 返回键实际是坏的。
  const call = VIEW.slice(VIEW.indexOf('createMobileSidebarBackHandler({'));
  const body = call.slice(0, call.indexOf('})'));
  assert.match(body, /isMobile: \(\) => isMobile\.value/, 'isMobile 要传函数');
  assert.match(body, /isOpen: \(\) => mobileSidebarOpen\.value/, 'isOpen 要传函数（原来整个漏掉）');
  assert.match(body, /open: \(\) =>/, 'open 要传函数，不是 ref 本身');
});

test('接口封装：地址/方法/超时都对得上', () => {
  const fn = fnBody(API, 'generateWorldMapPlaceImage');
  assert.ok(fn, 'api/index.js 里找不到 generateWorldMapPlaceImage');
  assert.match(fn, /`\/worldmap\/places\/\$\{placeId\}\/image`/, '地址要和后端路由逐字一致');
  assert.match(fn, /method: 'POST'/, '生成是写操作');
  assert.match(fn, /timeoutMs: 600_000/, '这一个请求含提示词准备 + ComfyUI 出图：默认 180 秒会把已经跑了一半的出图掐断');
  assert.match(VIEW, /import \{[\s\S]{0,200}generateWorldMapPlaceImage,[\s\S]{0,80}updateWorldMapPlace[\s\S]{0,80}\} from '\.\.\/api\/index\.js'/, '页面要同时拿到生图与保存两个接口');
});

test('透出地点配图：flattenTree 要把 image_url 带进前端模型', () => {
  const flat = fnBody(VIEW, 'flattenTree');
  assert.match(flat, /imageUrl: n\.image_url \|\| ''/, '后端字段是 image_url，前端模型是 imageUrl：这里漏了就永远显示「生成配图」');
});
