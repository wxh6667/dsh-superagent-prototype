## 实施顺序

1. 服务端与数据拆除（GitHub/Feishu 源、配置、迁移清理、文档、提示词、skill）。
2. 面板与文案拆除，依赖 1。
3. 启动页精简与创建即投递，依赖 1；与 2 串行以避开 locale 与 client 类型冲突。

## 已知事实

- 源插件框架在 `src/sources/kind.ts` 与 `registry.ts`，本地源为 `src/sources/local.ts`；GitHub/Feishu 模块仍在 `src/sources/github*.ts`、`feishu*.ts`。
- `src/app/runtime.ts` 仍接入 `pullEndNotices`、`feishuSettings`；`src/deployment.ts` 仍解析 GitHub 账号与 Feishu bot。
- 工作区可由 `ctx.workspaceRegistry.list()` 提供。
- 迁移入口 `src/app/migration.ts`，当前 schema 12。

## 提交与证据

主会话审查 worker diff 与验证后提交；每个子任务在本地提交中记录验证命令与结果。
