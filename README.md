# jack-mods

**English** · [Chinese (Simplified)](README.zh-CN.md)

My own Claude Code mods.

All three sit next to the model name below the prompt box: ⚡ quick-commands, 🪙 token-band (when collapsed), 🌐 translate-en.

![Toolbar buttons](docs/toolbar-buttons.png)

## token-band

A live token-usage band above the prompt box:

![Expanded](docs/token-band-expanded.png)

Click the collapse button and the whole band disappears; only a 🪙 is left at the right of the toolbar below the prompt box. Click it to expand again:

![Collapsed](docs/token-band-collapsed.png)

```
271.1k/1.00M (27%) · this turn 3.3k · 113 tok/s · total in 7.92M · total out 38.4k · cache 98% · $8.58 · 5h 99% · 7d 70% ✅   [collapse]
```

> The band's labels in the screenshots are currently Chinese; the line above shows the same fields in English, in the same order.

| Item | Meaning |
|---|---|
| `271.1k/1.00M (27%)` | Current context size / model window |
| this turn | Output tokens generated so far this turn, ticking up while the reply streams |
| `tok/s` | Average output speed: total output ÷ total generation time (first to last token, excluding time to first token) |
| total in / total out | Session totals, including cache reads/writes and subagents |
| cache | Share of total input served from cache; higher is cheaper |
| `$` | Session cost |
| `5h` / `7d` | Share of the 5-hour / 7-day subscription limit used (hidden on API billing) |
| `✅` / `❌` | Model check: turns ❌ and shows a toast with the reason when the main thread was switched to another model, the model returned by the API differs from the one requested, or thinking effort was silently lowered |

- On narrow windows the band wraps to two lines, with the collapse button pinned to the right of the first line.
- You can also type `/tokens` to toggle between expanded and collapsed.

## quick-commands

Adds a ⚡ button to the right of the model name. It opens a side panel so you don't have to type `/xxx` by hand:

- **Commands tab**: lists every slash command in the current session (built-in, your own, plugins and skills, MCP), grouped and searchable.
  - Common built-ins (`/compact`, `/clear`, `/context`, `/cost`, `/resume`, …) run with one click.
  - Everything else (skills, plugin and MCP commands) only fills `/name ` into the prompt box so you can add arguments and send it yourself. Nothing fires by accident.
  - The `⋯` next to a built-in lets you type arguments; when a command's output lists "Available: a, b, c" the mod remembers it and shows those as buttons next time.
- **Settings tab**: the `/config` settings as click targets. Toggles get On / Off, pick-one settings get one button per option, text and number settings get an input box. The current value has a blue background.
- **Chinese / English**: the UI follows `language` in `settings.json` or the system language by default; the 🌐 button switches between Auto / Chinese / English by hand. In Chinese, the English command and setting descriptions are translated with haiku and cached. In English, the engine's own descriptions are shown untouched.
- Click ⚡ to open; click it again (now ✕) or press Esc to close.

The ⚡ button, to the right of the model name:

![Button](docs/quick-commands-button.png)

The panel in English (descriptions and setting names are the engine's originals, unchanged):

![Commands tab (English)](docs/quick-commands-commands-en.png)
![Settings tab (English)](docs/quick-commands-settings-en.png)

## translate-en

Translates every message you send into English before it reaches Claude, using **your own model access**, not your Claude subscription. Made for someone learning Chinese: type in Chinese, Claude reads English and replies in Chinese.

- A 🌐 button always sits next to the model name, from the moment a session opens. It is dimmed when translation is off or not set up yet.
- Click it to open the settings panel and pick where translations come from:
  - **OpenAI-compatible API**: Base URL, API key, and a model fetched from `/models` (or typed by hand).
  - **ChatGPT subscription**: *Continue with ChatGPT* opens your browser to sign in with ChatGPT (Plus / Pro) and allow plan usage; no API key. Models come from your account. It follows OpenAI's [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source) flow for open-source local apps (PKCE, loopback callback on `127.0.0.1`, ID token signature check). macOS only.
  - A Test button translates a sample sentence with the current setup.
- What gets translated: messages you type, and the arguments of skill, plugin, MCP and your own slash commands (plus `/compact`'s instructions). English-only text, other built-in commands' arguments (`/model`, `/resume`, ...) and background notifications are left as they are.
- Claude is told, once in the session's system prompt, that you are learning Chinese and want replies in Simplified Chinese; each translated message carries its original text as extra context only the model sees. The transcript shows the English translation.
- If translation fails or takes longer than 9 seconds, the original text is sent and a toast says why.
- Requests to OpenAI-compatible APIs carry a stable `x-opencode-session` header and their own User-Agent, as OpenCode Go requires; other providers ignore them. Only `/chat/completions` is used there, and OpenCode's free-tier models refuse calls from outside OpenCode.

> The panel's labels are currently Chinese.
>
> Storage: the API key is kept **in plain text** in the plugin's local store (`~/.claude/plugins/store/translate-en_*.json`, readable only by your macOS user). ChatGPT sign-in credentials are kept **in the macOS Keychain** (`claude-translate-en`). To cut off a ChatGPT sign-in, use *Sign out* in the panel or disconnect the app in [ChatGPT settings](https://chatgpt.com/settings/usage).

## Install

One line (paste into a terminal):

```bash
claude plugin marketplace add crebot51/jack-mods && claude plugin install token-band@jack-mods
```

To install quick-commands or translate-en, swap the last name for `quick-commands@jack-mods` or `translate-en@jack-mods` (no need to add the marketplace again if you already have).

Then start a new session. token-band's band shows up on desktop only after the first message; quick-commands' ⚡ and translate-en's 🌐 sit next to the model name.

Update: `claude plugin update <name>`
Uninstall: `claude plugin uninstall <name>`

> The mod API is an early preview and may need updates across Claude Code versions.
