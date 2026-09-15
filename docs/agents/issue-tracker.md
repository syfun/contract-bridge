# 本地 Markdown 任务跟踪

- 每项功能使用 .scratch/<feature-slug>/ 目录。
- 规格保存为该目录中的 spec.md。
- 开发任务分别保存为 issues/<NN>-<slug>.md，从 01 编号。
- 每个任务顶部使用 Status: 记录状态，标签见 triage-labels.md。
- 任务依赖使用 Blocked by: 列出前置任务编号。
- 评论和处理记录追加到任务的 ## Comments 下。
- “发布到任务跟踪器”表示创建或更新对应 Markdown 文件。
- “读取任务”表示读取指定文件或编号对应的任务。

桥牌游戏使用功能标识 bridge-game。
现有规格迁入跟踪器时，原位置保留指向正式规格的链接，避免维护两份正文。
