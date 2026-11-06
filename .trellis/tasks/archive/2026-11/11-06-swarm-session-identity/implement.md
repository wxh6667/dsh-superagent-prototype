1. 在 SwarmManager 增加会话标识规范化与匹配。
2. swarmOf、masterFor、restore、open/finish 统一使用。
3. 派发工具确保带 swarmId。
4. 补回归测试：前缀/无前缀、未知 id、legacy、真实派发归属。
5. 运行 `scripts/verify.sh` 并记录。
