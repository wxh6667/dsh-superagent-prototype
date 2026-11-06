# 目标

新建 swarm 的 master 会话在第一次派发工单时，工单就带上正确的 swarm 归属，不需要等重启。

# 现状

`mainTools(host, agent, swarm)` 在会话装饰时就把 `swarmOf(agent.id)` 的结果作为参数固定下来；而 `SwarmManager.create` 先创建并装饰 master 会话，之后才保存 Swarm 记录。因此新 swarm 的 master 会话拿到的 swarm 永远是 undefined：它派发的工单没有 `swarmId`，线程与报告退回 legacy master，预算计数、swarm 状态统计、工作区清理与按 swarm 的模型覆盖都不生效。重启后会话重新装饰才恢复正常。

# 要求

- 主会话的工具在每次派发时解析当前 swarm，而不是使用会话创建时的快照。
- 新建 swarm 后立刻在该 master 会话里派发的工单必须带 `swarmId`，并计入该 swarm 的预算与状态。
- 不从属于任何 swarm 的会话仍按 legacy 行为工作；legacy/已完成的 swarm 不产生归属。
- 不改变既有工具签名语义与 Trellis 流程；保留现有测试。
- 测试覆盖：新建 swarm 后立即派发带归属、普通主会话无归属、swarm 结束后不再归属。

# 验收

- 新建 swarm，在其 master 会话派发工单：库中 `swarmId` 正确，预算与状态计数包含该工单。
- 不重启也成立；`scripts/verify.sh` 通过。

# 范围外

不改面板视觉、不改模型下拉的交互。
