# 桥牌小聚

面向熟人的单机与局域网桥牌游戏。当前已实现昵称建房、房间码入房、四方选座、房主开局、随机发牌、私有手牌展示、实时同步和刷新恢复；叫牌操作、打牌与电脑自动行动由后续任务交付。

## 本地开发

使用 Node.js 24（版本见 `.node-version`）与 pnpm 11.24.0。SQLite 使用 Node.js 内置的 `node:sqlite`，无需安装数据库服务；Node.js 24.11 启动时可能显示实验性 API 提示。

```sh
pnpm install
pnpm dev
```

打开 `http://localhost:3000`。Fastify 在 `0.0.0.0:3000` 同时提供构建后的页面、资源、业务接口和 Socket.IO，启动时打印可分享的局域网地址。每位真人牌手使用自己的浏览器进入同一地址。

`pnpm dev` 先构建前端，再监听服务端文件变更；修改前端后运行 `pnpm build` 并刷新浏览器。开发运行与 Windows 离线发行包是不同交付，后者由后续任务实现。

## 检查与运行

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm start
```

测试以对局应用服务公开入口为主，使用真实临时 SQLite，覆盖建房、入房、选座、越权、重复与过期操作、1～4 真人开局、完整发牌、手牌隔离、存储失败回滚和重启恢复；另有同源 HTTP 与 Socket.IO 集成测试。集成测试需要构建后的 `dist/` 并监听临时本地端口。

页面输出到 `dist/`，默认数据库位于 `data/bridge.sqlite`，已排除在 Git 之外。可用 `BRIDGE_DB` 指定独立数据路径，用 `PORT` 修改端口，例如：

```sh
BRIDGE_DB=/absolute/path/bridge.sqlite PORT=3001 pnpm start
```

## 房间操作契约

浏览器先通过 `POST /api/identity` 获取服务端生成的 256 位随机凭据，在本地保存后才提交建房或入房操作。SQLite 只保存凭据摘要；昵称、房间码、成员标识和 Socket.IO 连接标识均不能替代凭据。每份身份只能绑定一个房间，刷新或服务重启后使用原凭据恢复。

- `POST /api/commands`：提交 `create`、`join`、`seat` 或 `start`，均包含 `credential` 与唯一 `operationId`。建房创建版本 1；入房、选座和开局必须包含 `expectedVersion`。
- `GET /api/rooms/:code/join-version`：尚未入房的身份使用 `Authorization: Bearer <credential>` 取得入房预期版本，仅返回版本号。建房没有已有状态，因此无需预期版本。
- `GET /api/rooms/:code`：使用相同身份头读取所属房间的当前状态。
- Socket.IO：通过 `auth: { code, credential }` 鉴权，连接与重连后收到 `state`；成功提交操作后，每个连接分别取得该身份的状态。

SQLite 事务同步执行，服务进程内各房间操作按顺序提交。房间状态、成员身份绑定和操作记录在同一事务写入，提交后才确认和广播。同一身份重试同一操作标识及内容，不会重复推进状态；同标识不同内容返回 `operation_conflict`。成功响应包含当前可见 `state` 和原操作的 `appliedVersion`，因此即使后来已有其他操作，仍能识别原操作已提交。

响应 `status` 区分 `accepted`、`illegal_action`、`unauthorized`、`stale_state`、`storage_failure`、`room_not_found`、`duplicate_nickname`、`seat_taken` 与 `operation_conflict`。失败返回中文 `message`。浏览器在响应丢失或保存失败时保留待确认操作，提供同标识重试；过期选座会重新获取状态。

## 开局与私有手牌

房主先入座，再点击“开始第一副”。服务端检查房主权限、预期版本和牌局阶段，随机分配完整 52 张牌，每家 13 张。支持 1～4 个真人座位，空位标记为电脑座位。首副为第 1 副、北家发牌、双方无局、北家首先叫牌；叫牌操作与电脑自动行动尚未开放，因此当前停留在初始叫牌阶段。

开局后座位锁定，未入座及中途加入者等待下一副，不能领取电脑座位的手牌。页面显示副号、发牌人、局况、行动方、各家张数和本人手牌，等待者只显示等待提示。

完整四家手牌保存在服务端 `StoredBoard` 中。所有成功响应、HTTP 读取、实时推送及重连快照共用按身份生成的视图：`board` 只包含公开牌副信息，`hand` 仅包含本人手牌，等待者为空数组。错误响应不携带牌局状态。旧版尚未开局的房间存档仍可读取。

发牌状态与操作记录在同一事务持久化。重试原开局操作返回当前可见状态与原提交版本，不重新洗牌；新操作标识也不能再次启动已经开始的牌副。服务重启后沿用已保存的牌，不重新生成。

## 项目资料

- [正式规格](.scratch/bridge-game/spec.md)
- [开发任务](.scratch/bridge-game/issues/)
- [UI 参考稿](design/references_classic.html)
- [领域术语](CONTEXT.md)
- [架构决策](docs/adr/0001-local-authoritative-web-service.md)
