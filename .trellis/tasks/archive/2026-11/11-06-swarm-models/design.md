现状：`sessions.ensure` 按角色读取 `settings.eval.model`（主 Session）与 `settings.executor.model`（执行器）；`SwarmManager.create` 只传 id/cwd/title。

实现要点：
- Swarm 增加可选 `masterModel` 与 `workerModel`（结构与既有 RoleModel 一致），仅在新 swarm 上保存，缺省不写入。
- 会话建立处接收模型覆盖：主会话取 swarm.masterModel，执行器会话取所属 swarm 的 workerModel；无覆盖时回落到全局设置。
- 执行器会话在创建时按 ticket 的 swarmId 找到对应 swarm，避免跨 swarm 复用错误模型。
- 启动页在既有高级选项中加入两个下拉，首项为继承；模型目录复用 `GET models`。
- 覆盖值在 swarm 行与高级选项中可辨识，但不改变既有只读/完成态行为。
