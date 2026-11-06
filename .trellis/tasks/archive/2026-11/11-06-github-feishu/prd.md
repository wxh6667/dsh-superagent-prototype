# 目标

仓库只保留本地源。GitHub 与 Feishu 的来源实现、配置、安装检测、策略、轮询、订阅通知、外链、线程上下文读取、专用提示词与 skill 全部删除，历史记录在迁移中清除。

# 要求

- 删除 `src/sources/github*.ts`、`src/sources/feishu*.ts` 及仅为其服务的轮询模块；保留 `local.ts`、`kind.ts`、`registry.ts`、`host.ts` 等通用框架。
- `src/deployment.ts` 移除 GitHub 账号与 Feishu bot 的 schema、解析与安装字段；`src/setup.ts` 移除对应检测与 `feishuProblem`。
- `src/policy.ts` 移除 GitHub/Feishu 策略段，保留本地源的 admission 机制。
- `src/app/runtime.ts`、`resources.ts`、`links.ts`、`cards.ts`、`assessment.ts`、`outbox.ts`、`notices.ts`、`tools/main.ts`、`app/http.ts` 移除 GitHub/Feishu 分支与订阅通知；不改变本地源的 Thread/Ticket 行为。
- `prompts/subscriptions.md` 与 `skills/dsh-superagent-github`、`skills/dsh-superagent-feishu` 删除；其余提示词与 `docs/` 中相关描述改为仅本地源。
- 迁移升到 schema 13：迁移前把当前数据库文件复制到 state 目录下 `backups/`（带时间戳），然后删除非本地来源的触发、线程、票据、决策、设置项与策略段。本地来源记录及与来源无关的设置必须完整保留；迁移需在事务中完成，失败时不留半成品。
- 清理对应的 GitHub/Feishu 测试与 fixture；保留并更新通用测试。

# 验收

- 代码库中不再有 GitHub/Feishu 源实现、配置字段、安装检测、订阅通知与 skill；`grep` 证据随报告提交。
- 从 schema 12 数据库升级到 13 后，非本地记录与设置被清除，本地记录保留；备份文件存在；旧于 10 的库仍按既有规则拒绝。
- `scripts/verify.sh` 通过，报告记录命令与结果。

# 范围外

不改面板 UI（下一子任务处理）、不改启动页、不动 Trellis 与 worker 流程。
