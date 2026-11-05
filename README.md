# skilly

在终端里管理 AI agent skills。列表、上游、检查、更新、删除都交给 [`npx skills`](https://github.com/vercel-labs/skills)，skilly 不自己实现安装器。添加时走默认的 **symlink**，不会传 `--copy`。

## 安装

需要 Node.js 20+ 和 [pnpm](https://pnpm.io)。

```bash
pnpm install
pnpm skilly
```

构建后直接跑产物（`package.json` 的 bin 也是这个文件）：

```bash
pnpm build
node dist/cli.js
```

## 配置

首次运行会写下 `~/.config/skilly/config.toml`（尊重 `$XDG_CONFIG_HOME`，也可用 `SKILLY_CONFIG` 或 `--config`）：

```toml
project_globs = ["~/code/0froq/**"]
```

在 TUI 里按 `g` 编辑这些 glob。发现项目时只保留像项目的目录：带 `.git`、`package.json`、`.agents/skills` 或 `skills-lock.json`。嵌在 git 仓库里、自己没有 skills 目录的子目录会跳过。

- 全局：`npx skills list -g --json`（`~/.agents/skills`）
- 项目：在每个发现的目录里执行 `npx skills list --json`
- 左侧按 `global` 和项目路径分组。状态标记留在技能行上（`?` 未跟踪，`!` 缺失，`↑` 有更新）
- 扫描时只显示进度（当前路径和计数），不把 npm 警告或 list JSON 打到界面上
- 右侧在简短元数据下面显示该技能 `SKILL.md` 正文（frontmatter 之后的 markdown）
- 删除只复查该技能所在的全局目录或那一个项目，不再重扫所有 glob。命令退出成功但技能还在列表里时，保留这一项并标明没删掉。若剩下的是规范路径上的未跟踪符号链接，只 `unlink` 这一条，不删除它指向的源目录

`SKILLY_SKILLS_BIN` 可以指向本机的 `skills` 可执行文件，用来代替 `npx --yes skills`。

## 按键

| 键 | 作用 |
| --- | --- |
| `j` / `k`，方向键 | 移动 |
| `f`，`Tab` | 切换范围：全部 / 全局 / 各个项目 |
| `/` | 按名字或来源过滤 |
| `r` | 刷新 |
| `c` | 检查更新（`npx skills check`） |
| `u` | 更新当前 tracked skill |
| `U` | 更新当前范围内全部 tracked |
| `d` | 删除，`y` 确认 |
| `a` | 添加（symlink，`-y`，不传 `--copy`） |
| `g` | 编辑 project globs |
| `[` / `]` | 滚动右侧 SKILL.md 正文 |
| `l` | 查看上一条命令输出 |
| `?` | 帮助 |
| `q` | 退出 |

`list` 和 `add` 会解析 `--json`。`check` / `update` / `remove` 也会带上 `--json`；当前 CLI 会忽略这个旗标，skilly 再解析文本（例如 `↑ name has an update`）。

添加时默认 `-a '*'`。多个 agent 目录不一样时，skills CLI 会做 symlink。如果目标都落在同一个目录（比如只装给 Cursor，项目里就是 `.agents/skills`），CLI 自己会改用 copy，因为没有第二份目录可链接。skilly 不会额外传 `--copy`，也不会把已经是 symlink 的 skill 改成 copy。

## English

skilly is a terminal UI over the Vercel skills CLI. It lists global skills and project skills discovered from `project_globs`, grouped under `global` and each project path. The scan view shows progress instead of npm warnings or list JSON. The detail pane shows a short metadata block and the selected skill's `SKILL.md` body, read from disk. Deleting a skill relists only that scope and keeps the row when it is still installed. If that remaining install is an untracked symlink at `.agents/skills/<name>`, skilly unlinks that entry only and leaves the source directory in place. It shows tracked status and whether a skill folder is a symlink or a real directory, and runs check, update, remove, and add through `npx skills`. It never passes `--copy`. The CLI itself copies only when every selected agent shares one directory, because there is no second path to symlink.

## License

MIT
