# jack-mods

[English](README.md) · **简体中文**

自己写的 Claude Code mods。

三个 mod 的按钮都在输入框下方、模型名旁边：⚡ quick-commands、🪙 token-band（收起时）、🌐 translate-en。

![输入框下方的按钮](docs/toolbar-buttons.png)

## token-band

在输入框上方实时显示 token 用量：

![展开状态](docs/token-band-expanded.png)

点「收起」后整栏消失，只在输入框下方工具栏右侧留一个 🪙，点它展开：

![收起状态](docs/token-band-collapsed.png)

```
271.1k/1.00M (27%) · 本轮 3.3k · 113 tok/s · 总输入 7.92M · 总输出 38.4k · 缓存 98% · $8.58 · 5h 99% · 7d 70% ✅   [收起]
```

| 项目 | 含义 |
|---|---|
| `271.1k/1.00M (27%)` | 当前上下文占用 / 模型窗口 |
| `本轮` | 这一轮已生成的输出 token，回复过程中实时跳动 |
| `tok/s` | 平均输出速度：总输出 ÷ 总生成时间（从首个字到最后一个字，不含等待首字） |
| `总输入` / `总输出` | 本会话累计，含缓存读写和子 agent |
| `缓存` | 总输入中命中缓存的比例，越高越省钱 |
| `$` | 本会话费用 |
| `5h` / `7d` | 订阅账号的 5 小时 / 7 天额度已用比例（按 API 计费时不显示） |
| `✅` / `❌` | 模型检测：主对话被切到别的模型、接口返回的模型和请求的不一致、或思考强度被静默调低时变成 ❌，并弹出提示说明原因 |

- 窗口窄时自动折成两行，「收起」按钮固定在第一行右边
- 也可以输入 `/tokens` 在展开和收起之间切换

## quick-commands

在模型名右边加一个 ⚡ 按钮，点开右侧面板，不用再手打 `/xxx`：

- **命令页**：列出当前会话的全部斜杠命令（内置、自己的、插件和 skill、MCP），按分组显示，可搜索。
  - 常用内置命令（`/compact`、`/clear`、`/context`、`/cost`、`/resume` 等）点一下直接执行。
  - 其余命令（技能、插件、MCP 等）点一下只把 `/名字 ` 填进输入框，接着补参数再发送，不会误触发。
  - 内置命令右边的 `⋯` 可手动填参数；命令输出里列出「Available: a, b, c」时会记住，下次直接给选项按钮。
- **设置页**：把 `/config` 里的设置做成点选：开关点「开 / 关」，多选一直接点选项，文字、数字给输入框。当前值是蓝底。
- **中英文**：界面默认跟着 `settings.json` 的 `language` 或系统语言，也可以点 🌐 手动在「自动 / 中文 / English」间切换。中文下命令和设置的英文说明会用 haiku 翻成中文并缓存；英文下原样显示引擎自带的说明。
- 点 ⚡ 打开，再点（此时是 ✕）或按 Esc 关闭。

模型名右边的 ⚡ 按钮：

![按钮](docs/quick-commands-button.png)

命令页和设置页：

![命令页（中文）](docs/quick-commands-commands-zh.webp)
![设置页（中文）](docs/quick-commands-settings-zh.png)

## translate-en

你发出的每条消息，先用**你自己的 OpenAI 兼容接口**（自定义 Base URL + Key）翻成英文再发给 Claude，不占 Claude 订阅的额度。适合学中文的人：用中文打字，Claude 读英文、用中文回复。

- 模型名旁边常驻一个 🌐 按钮，会话一打开就在；翻译关着或还没配置好时是灰色
- 点开是设置面板：开关、Base URL、API Key、模型（从 `/models` 拉取后在列表里点选，也可以手动填），以及「测试」按钮，用一句示例中文实际调用一次
- 只翻译你自己打的消息；斜杠命令、纯英文、后台通知原样发送
- **用中文回复**（默认开启）：在会话的系统提示词里加一节，说明用户在学中文、请用简体中文回复，并在每条翻译过的消息后附上原文。这些只有模型能看到，对话记录里显示的是英文译文
- 翻译失败或超过 9 秒没返回，就照原文发送，并弹出提示说明原因
- 请求会带上固定的 `x-opencode-session` 和自己的 User-Agent（OpenCode Go 要求），其他接口会忽略
- 只调用 `/chat/completions`，模型必须支持这个接口；OpenCode 的免费模型只能在 OpenCode 里用，第三方调用会被拒绝

> Key **明文**保存在插件的本地存储里（`~/.claude/plugins/store/translate-en_*.json`，只有当前 macOS 用户可读）。

## 安装

一行命令（复制到终端回车即可）：

```bash
claude plugin marketplace add crebot51/jack-mods && claude plugin install token-band@jack-mods
```

想装 quick-commands 或 translate-en，把最后的名字换成 `quick-commands@jack-mods` 或 `translate-en@jack-mods`（marketplace 已添加过就不用再 add）。

装好后开一个新会话：token-band 的用量条桌面端需要先发一条消息才出现；quick-commands 的 ⚡ 和 translate-en 的 🌐 在模型名旁边。

更新：`claude plugin update <名字>`
卸载：`claude plugin uninstall <名字>`

> mod 接口目前是早期预览，Claude Code 版本差异较大时可能需要更新。
