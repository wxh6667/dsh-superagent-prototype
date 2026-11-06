根因：`Runtime` 的 tools 工厂 `(agent, ticket) => mainTools(this.toolHost, agent, this.swarms.swarmOf(agent.id))` 在装饰时求值；`SwarmManager.create` 的 `ensureMaster` 触发装饰时 swarm 尚未保存。

实现要点：
- 把 swarm 参数改为按调用解析（传 `() => Swarm | undefined` 或在工具执行内调用 `swarmOf(agent.id)`）。
- 保持 `trellisOf`、预算检查、local 线程键与派发元数据的现有行为，仅替换取值时机。
- 测试：新建 swarm（保存后）在同一会话派发带归属；legacy 主会话无归属；完成后 masterFor 不再归属。
