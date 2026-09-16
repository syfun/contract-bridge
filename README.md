# 桥牌小聚

面向熟人的单机与局域网桥牌游戏，真人不足时由电脑牌手补位。目前已初始化 React、TypeScript 与 Vite 前端工程，房间、桥牌规则和服务端尚待实现。

## 本地开发

使用 Node.js 24（版本见 `.node-version`）与 pnpm 11.24.0。

```sh
pnpm install
pnpm dev
```

需要从局域网其他设备查看开发页面时，运行 `pnpm dev --host 0.0.0.0`。开发服务器仅用于开发，Windows 离线运行包由后续任务交付。

## 检查与构建

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm preview
```

构建结果输出到 `dist/`。当前使用 Vite 模板提供的 Oxlint 检查代码，业务测试工具将在相关任务中配置。

## 项目资料

- [正式规格](.scratch/bridge-game/spec.md)
- [开发任务](.scratch/bridge-game/issues/)
- [UI 参考稿](design/references_classic.html)
- [领域术语](CONTEXT.md)
- [架构决策](docs/adr/0001-local-authoritative-web-service.md)
