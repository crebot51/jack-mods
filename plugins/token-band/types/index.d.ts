export type TokenStats = {
  /** 本会话累计输入 token：新输入 + 缓存读 + 缓存写（含子 agent）。旧状态里可能没有 */
  totalInput?: number
  /** 缓存命中率的分子和分母：同一时刻开始统计，避免旧数据把比例拉偏。旧状态里可能没有 */
  totalCacheRead?: number
  cacheInput?: number
  /** 本会话累计输出 token（含子 agent） */
  output: number
  /** 本轮已生成的输出 token（含子 agent） */
  turnOutput: number
  /** 测速用：计入测速的输出 token 与生成耗时（毫秒）。热重载前的旧状态里可能没有 */
  speedTokens?: number
  speedMs?: number
  /** 当前上下文占用和窗口大小。旧状态里可能没有 */
  contextTokens?: number | null
  contextWindow?: number | null
  /** 订阅额度：five_hour / seven_day 等窗口的已用百分比。旧状态里可能没有 */
  rateLimits?: { kind: string; percentUsed: number }[]
  /** 本会话费用（美元） */
  usd: number | null
}

/** 模型一致性检查（只看主对话） */
export type ModelCheck = {
  /** 最近一轮发现的异常，例如「实际回答 sonnet-4-5」「强度 high→medium」 */
  issues: string[]
  /** 最近一次请求的思考强度（静默降级之前） */
  effortWanted: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'token-band': { stats: TokenStats; isHidden: boolean; check: ModelCheck }
  }
}
