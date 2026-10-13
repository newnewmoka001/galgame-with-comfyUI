/**
 * 世界地图 · 树 → 扁平列表 / 展开记忆（纯函数，唯一真源）。
 *
 * 为什么要提取：View 里 `flatTree`（折叠感知）与 `fullFlat`（忽略折叠）是同一段 walk 的两份拷贝，
 * 而回归测试过去是在**测试文件里再抄第三份** —— 等于测复制品，生产逻辑坏了测试也不会红。
 * 这里收成唯一真源：View 与测试都从这里取（阶段 3 对 E 类"复刻实现"的处置）。
 *
 * 语义钉死：展开集合是 `expanded`（默认**全折叠**），不是 `collapsed`（默认全展开）——
 * 反过来会让用户每次进页面都看到一棵爆开的树（历史 bug）。
 */

/** 树 → 扁平列表（带 `_depth` 缩进深度）；**未显式展开的节点不输出其子树** */
export function flattenVisibleTree(tree, expanded) {
  const out = []
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      out.push({ ...n, _depth: depth })
      if (expanded.has(n.id) && n.children?.length) walk(n.children, depth + 1)
    }
  }
  walk(tree || [], 0)
  return out
}

/** 全部展开（忽略折叠状态）—— 编辑弹窗的「上级地点」候选要用全量 */
export function flattenFullTree(tree) {
  const out = []
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      out.push({ ...n, _depth: depth })
      if (n.children?.length) walk(n.children, depth + 1)
    }
  }
  walk(tree || [], 0)
  return out
}

/**
 * 从落盘的记忆里取出某张图的展开集合。
 *
 * localStorage 是用户可改、旧版本可能写坏的输入，所以**非数字项一律丢弃**
 * （`Number.isFinite` 过滤）—— 脏项会让 `expanded.has()` 恒不命中，表现为"记忆失效"。
 *
 * @param {object} rawAll - 已 JSON.parse 的整份记忆（形如 { '11': [1,2], '12': [9] }）
 * @param {number|string} mapId
 * @returns {Set<number>}
 */
export function expandedFromMemory(rawAll, mapId) {
  const arr = rawAll?.[String(mapId)]
  return new Set(Array.isArray(arr) ? arr.filter(x => Number.isFinite(x)) : [])
}
