# jack-mods

自己写的 Claude Code mods。

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

## 安装

一行命令（复制到终端回车即可）：

```bash
claude plugin marketplace add crebot51/jack-mods && claude plugin install token-band@jack-mods
```

装好后开一个新会话即可看到用量条（桌面端需要先发一条消息）。

更新：`claude plugin update token-band`
卸载：`claude plugin uninstall token-band`

> mod 接口目前是早期预览，Claude Code 版本差异较大时可能需要更新。
