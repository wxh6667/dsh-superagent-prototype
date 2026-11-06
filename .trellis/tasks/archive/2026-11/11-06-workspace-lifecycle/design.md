现状：`Sessions.ensure` 对每个 cwd 调用 `workspaceRegistry.create(cwd)`，同路径复用，新路径会新增注册；worker 会话 cwd 是 worktree，master 会话 cwd 是 swarm 工作区。

实现要点：
- 在会话建立路径上记录本次 `create` 是否新增：调用前取 `workspaceRegistry.list()` 的 id 集合，调用后若返回的 id 不在其中则为新建，按 swarm 记入持久化（沿用 Store 的 KV 约定）。
- swarm 结束时按记录删除注册；删除前确认记录归属该 swarm 且不是用户原有工作区。
- 启动页工作区列表 = 注册表列表减去活跃 swarm 记录的临时工作区；已完成 swarm 的遗留记录同样过滤并在下次清理。
- 状态数据从现有 Ticket 与 assignment 状态计算，作为 `GET swarms` 的附加字段返回，不新增持久化来源。
