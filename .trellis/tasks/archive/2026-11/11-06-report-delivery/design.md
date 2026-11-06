现状：`Sessions.relay` 与 `inject` 通过 `masterFor(swarmId)` 解析目标；无 swarmId 时回落到 `host.masterId`。`orchestrator_local_dispatch` 允许任意主会话派发工单，工单没有记录派发会话，因此报告无法回到发起者。

实现要点：
- 派发时把发起会话 id 写入工单（或派发记录），随工单持久化。
- 解析顺序：Swarm master → 派发会话 → 无目标时记录失败原因。
- relay/notice 的 swarmId 参数扩展为可按工单解析目标，避免所有调用点各自拼装。
- 迁移无需改 schema：新字段可选，旧记录缺省按现有回落逻辑。
