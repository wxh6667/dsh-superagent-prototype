# 目标

Swarm 与其 master 会话的标识必须一致可解析：从该会话派发的工单带上 swarm 归属，报告回到该 swarm 的 master，而不是 legacy master。

# 现状

`SwarmManager` 用 `masterSessionId = orchestrator-<swarmId>` 创建会话，但 DSH 实际会话 id 带 `dsh_` 前缀（`dsh_orchestrator-<swarmId>`）。`swarms.swarmOf(agent.id)` 与 `masterFor` 都用严格相等比较，因此匹配失败：本会话虽属于活跃 swarm「superagent」，派发出去的工单却没有 `swarmId`，线程与报告落到 legacy master（`orchestrator-3baabb…`）。

# 要求

- 统一会话标识的解析规则：无论调用方给的是带前缀还是不带前缀的 id，都能解析到同一个 Swarm 与其 master。
- `swarmOf`、`masterFor`、`open`、`finish`、工作区记录与派发工具使用同一套解析，不再各自比较字符串。
- 从 swarm master 会话派发的工单必须带上 `swarmId`；报告、attention 与结束通知回到该 master。
- 兼容已有数据：已保存的 `masterSessionId` 无需迁移即可解析；legacy 记录不报错。
- 测试覆盖带前缀/不带前缀、未知 id、legacy 回落与实际派发归属。

# 验收

- 在活跃 swarm 的 master 会话里派发工单，工单记录带正确的 `swarmId`。
- 该工单结束后，报告出现在同一 master 会话。
- `scripts/verify.sh` 通过。

# 范围外

不改消息回传的解析顺序（上一子任务已完成），不改面板展示。
