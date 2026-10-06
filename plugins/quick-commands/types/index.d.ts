/** 面板里列出的一条命令 */
export type QuickCommand = {
  /** 命令名，不带斜杠 */
  name: string
  description: string
  /** 来源：builtin / plugin / user / mcp。旧状态里可能没有 */
  source?: string
}

/** 界面语言：中文或英文 */
export type Lang = 'zh' | 'en'

/** 语言偏好：auto 跟着 settings.json 的 language / 系统语言，或手动指定 */
export type LangPref = 'auto' | Lang

/** 点命令后：直接执行，或填进输入框等补参数 */
export type RunMode = 'run' | 'fill'

/** 面板当前显示哪一页 */
export type Tab = 'commands' | 'settings'

/** /config 里的一行设置，只留面板要用的字段 */
export type SettingRow = {
  key: string
  label: string
  description?: string
  kind: 'boolean' | 'choice' | 'text' | 'number'
  value: boolean | string | number | readonly string[]
  options?: readonly string[]
  isLocked: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'quick-commands': {
      isOpen: boolean
      commands: QuickCommand[]
      mode: RunMode
      query: string
      tab: Tab
      /** 正在看哪个命令的参数页；null 表示在列表 */
      detail: string | null
      /** 学到的命令参数可选值：命令名 -> 可选值 */
      learned: Record<string, string[]>
      settings: SettingRow[]
      /** 手动选的界面语言，auto 表示自动判断 */
      langPref: LangPref
      /** 自动判断出的界面语言 */
      langAuto: Lang
      /** 译文缓存：`id|原文` -> 中文 */
      zh: Record<string, string>
      /** 当前模型，用来在 /model 的选项里高亮 */
      model: string
      /** 设置页上一次操作的结果提示 */
      notice: string
    }
  }
}
