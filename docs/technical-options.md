# 技术选型

状态：基础技术选型已由用户确认。核实日期：2026-09-15。更强电脑引擎仍为研究候选。

## 已确认基线

- 前端：React、TypeScript、Vite，使用 HTML/CSS 绘制响应式牌桌。
- 服务端：Node.js 当前受支持的 LTS、TypeScript、Fastify，提供网页和业务接口。
- 实时通信：Socket.IO；服务端验证所有操作，按座位生成可见状态。
- 存储：Windows 服务端本地磁盘上的 SQLite，保存对局状态及操作记录；浏览器不直接访问数据库文件。
- 部署：一个局域网访问入口，页面、字体、图片和脚本都由本机服务提供；玩家无需安装。
- 服务端交付：Windows 解压后双击启动的目录，附带所需运行环境和已构建网页，显示局域网地址；数据目录与程序分离，管理员无需安装开发工具。
- 容量验证目标：10 桌同时游玩，包含电脑决策负载；属于待实测的验收目标，不是已验证的容量结论。
- 规则：独立于界面和网络的 TypeScript 规则模块，负责合法性、状态推进及计分。
- 电脑牌手：先采用规则驱动的基础实现，提供可替换接口；更强引擎的 Windows 兼容性、叫牌约定匹配及运行成本须另行验证。

## 选择理由与限制

- 前后端共用 TypeScript，便于统一牌、叫品和消息类型。具体框架为工程建议，不是唯一可行方案。
- Vite 用于构建前端静态产物，部署时由正式 Web 服务提供；不使用 Vite 预览服务承担正式对局。
- Socket.IO 提供连接恢复机制，但不能保证恢复总是成功，也不自动提供业务层完整可靠性。应用仍需命令去重、状态版本、确认响应及重连后重新获取座位可见状态。
- SQLite 适合单机应用服务内嵌存储；应置于服务端本地磁盘，避免网络共享文件。以 10 桌并发为验证目标，不能由数据库名称推断实际容量。
- 每桌操作顺序执行，成功操作在数据库事务提交后才确认并广播；状态和操作记录保持一致。重启恢复不依赖 Socket.IO 的内存状态。
- 电脑决策接口只接收合法可见信息；未来耗时搜索应与网络请求处理隔离，避免一桌思考阻塞其他房间。

## 官方资料

- [React 创建应用](https://react.dev/learn/creating-a-react-app)
- [Vite 构建产物与部署](https://vite.dev/guide/static-deploy)
- [Fastify TypeScript 支持](https://fastify.dev/docs/latest/Reference/TypeScript/)
- [Socket.IO 连接恢复](https://socket.io/docs/v4/connection-state-recovery/)
- [Socket.IO 消息送达保证](https://socket.io/docs/v4/delivery-guarantees/)
- [SQLite 适用场景](https://sqlite.org/whentouse.html)

## 更强电脑引擎研究

- 第一阶段沿用规则驱动的简化自然叫牌和基础打牌策略；只承诺基本陪玩目标，实际牌力须评估。
- [DDS](https://github.com/dds-bridge/dds) 是针对四手已知牌局的双明手求解器，不能直接作为完整的隐藏信息电脑牌手，也不提供完整叫牌策略。未来可让它评估基于合法信息采样出的假设牌局，不能传入服务器保存的实际暗牌。
- [BEN](https://github.com/lorserker/ben) 是包含叫牌、首攻和打牌能力的机器人候选。其官方文档说明 Windows 支持并提供 [REST 接口](https://github.com/lorserker/ben/blob/main/README-api.md)，可考虑作为本机独立 AI 服务。
- BEN 默认 [叫牌约定](https://github.com/lorserker/ben/blob/main/convention_card.md) 为 2/1 game forcing，不能直接视为与本项目简化自然体系一致。需要验证约定匹配、运行依赖、分发条件、离线行为、决策耗时及实际牌力，才能决定是否采用。
- 以上属于官方文档研究，尚未在本机安装或运行这些引擎，不作为基础版必选依赖。
