# 桥牌小聚

面向熟人的单机与局域网桥牌游戏。当前已实现昵称建房、房间码入房、四方选座、房主开局、随机发牌、私有手牌展示、真人叫牌与定约认定、实时同步和刷新恢复；打牌与电脑自动行动由后续任务交付。

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

测试以对局应用服务公开入口为主，使用真实临时 SQLite，覆盖建房、入房、选座、越权、重复与过期操作、1～4 真人开局、完整发牌、手牌隔离、叫牌合法性、加倍与再加倍、全体不叫、庄家与首攻方认定、存储失败回滚和重启恢复；另有同源 HTTP 与 Socket.IO 集成测试。集成测试需要构建后的 `dist/` 并监听临时本地端口。

页面输出到 `dist/`，默认数据库位于 `data/bridge.sqlite`，已排除在 Git 之外。可用 `BRIDGE_DB` 指定独立数据路径，用 `PORT` 修改端口，例如：

```sh
BRIDGE_DB=/absolute/path/bridge.sqlite PORT=3001 pnpm start
```

## 房间操作契约

浏览器先通过 `POST /api/identity` 获取服务端生成的 256 位随机凭据，在本地保存后才提交建房或入房操作。SQLite 只保存凭据摘要；昵称、房间码、成员标识和 Socket.IO 连接标识均不能替代凭据。每份身份只能绑定一个房间，刷新或服务重启后使用原凭据恢复。

- `POST /api/commands`：提交 `create`、`join`、`seat`、`start` 或 `call`，均包含 `credential` 与唯一 `operationId`。建房创建版本 1；入房、选座、开局和叫牌必须包含 `expectedVersion`。
- `GET /api/rooms/:code/join-version`：尚未入房的身份使用 `Authorization: Bearer <credential>` 取得入房预期版本，仅返回版本号。建房没有已有状态，因此无需预期版本。
- `GET /api/rooms/:code`：使用相同身份头读取所属房间的当前状态。
- Socket.IO：通过 `auth: { code, credential }` 鉴权，连接与重连后收到 `state`；成功提交操作后，每个连接分别取得该身份的状态。

SQLite 事务同步执行，服务进程内各房间操作按顺序提交。房间状态、成员身份绑定和操作记录在同一事务写入，提交后才确认和广播。同一身份重试同一操作标识及内容，不会重复推进状态；同标识不同内容返回 `operation_conflict`。成功响应包含当前可见 `state` 和原操作的 `appliedVersion`，因此即使后来已有其他操作，仍能识别原操作已提交。

响应 `status` 区分 `accepted`、`illegal_action`、`unauthorized`、`stale_state`、`storage_failure`、`room_not_found`、`duplicate_nickname`、`seat_taken` 与 `operation_conflict`。失败返回中文 `message`。浏览器在响应丢失或保存失败时保留待确认操作，提供同标识重试；过期操作会重新获取状态。

## 开局与私有手牌

房主先入座，再点击“开始第一副”。服务端检查房主权限、预期版本和牌局阶段，随机分配完整 52 张牌，每家 13 张。支持 1～4 个真人座位，空位标记为电脑座位。首副为第 1 副、北家发牌、双方无局、北家首先叫牌。电脑暂不自动行动，完整叫牌流程使用四名真人验证。

开局后座位锁定，未入座及中途加入者等待下一副，不能领取电脑座位的手牌。页面显示副号、发牌人、局况、行动方、各家张数和本人手牌，等待者可查看公开叫牌记录和当前行动方，但不能操作或查看手牌。

完整四家手牌保存在服务端 `StoredBoard` 中。所有成功响应、HTTP 读取、实时推送及重连快照共用按身份生成的视图：`board` 只包含公开牌副信息，`hand` 仅包含本人手牌，等待者为空数组。错误响应不携带牌局状态。旧版尚未开局的房间存档仍可读取。

发牌状态与操作记录在同一事务持久化。重试原开局操作返回当前可见状态与原提交版本，不重新洗牌；新操作标识也不能再次启动已经开始的牌副。服务重启后沿用已保存的牌，不重新生成。

## 真人叫牌

轮到本人时，页面显示服务端提供的合法定约叫品及 Pass、加倍和再加倍操作。`call` 操作携带 `call: { kind: 'pass' | 'double' | 'redouble' }`，或 `call: { kind: 'bid', level: 1..7, denomination: 'C' | 'D' | 'H' | 'S' | 'NT' }`。服务端独立校验身份、轮次、级别和阵营；正常轮次不限时。

开局四家不叫后进入 `passed-out`，没有定约或行动方；有效叫品、加倍或再加倍后连续三次不叫，进入 `opening-lead`。公开 `contract` 保存最终级别、花色、加倍状态、庄家与首攻方，`turn` 指向庄家的左手方。庄家是最终定约一方最早叫过该花色的人。新定约叫品清除先前的加倍状态。

`board.auction` 保存按次序排列的完整公开记录；`board.legalCalls` 仅对当前行动的真人身份提供。叫牌与版本、操作记录同事务提交，失败或过期不改变已确认状态。旧版已发牌存档按空叫牌记录继续使用。首攻出牌、结束后的结算与准备下一副界面由后续任务交付。

叫牌规则核对依据：[WBF《2017 复式桥牌规则》](https://www.worldbridge.org/wp-content/uploads/2017/03/2017LawsofDuplicateBridge-paginated.pdf)第 18、19、22 条及庄家定义。

## 项目资料

- [正式规格](.scratch/bridge-game/spec.md)
- [开发任务](.scratch/bridge-game/issues/)
- [UI 参考稿](design/references_classic.html)
- [领域术语](CONTEXT.md)
- [架构决策](docs/adr/0001-local-authoritative-web-service.md)
