根因：DSH 的 `sessionController` 在创建会话时给 id 加 `dsh_` 前缀，而 Swarm 持久化的 `masterSessionId` 是不带前缀的 `orchestrator-<swarmId>`；`Sessions` 的 agent id 是带前缀形式。

实现要点：
- 增加一个规范化函数（去/加 `dsh_` 前缀）与双向匹配，放在 SwarmManager 内，`swarmOf`/`masterFor`/`restore` 共用。
- 派发工具取 swarm 时同时尝试 agent.id 与规范化后的 id。
- 投递目标解析继续按「Swarm master → 发起会话 → legacy」，其中 Swarm 解析走新规则。
- 不回写数据库；已有记录不变。
