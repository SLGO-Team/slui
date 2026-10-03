# SLUI

SCP: Secret Laboratory 的 Windows 游戏覆盖层客户端，配合 SLGO 服务器使用，提供 HUD、商店、聊天和小地图。基于 Tauri、React 和 TypeScript。

## 开发

```bash
npm install
npm run dev:mock     # 浏览器预览，使用内置 mock 数据
npm run tauri:mock   # 桌面应用，使用内置 mock 数据
npm run tauri dev    # 桌面应用，连接 .env.development 中配置的后端
npm test
```

| 命令 | 用途 |
| --- | --- |
| `npm run tauri:build:local` | 连接本地后端的测试安装包 |
| `npm run installer:build` | 正式安装器 `SLUI-Setup-<version>.exe`，需要设置 `VITE_CONTROL_PLANE_URL` |

SLUI 需要与游戏运行在同一台电脑、同一网络连接上，服务器才会接受连接。

## 主题包

字体和音效可以用可选的主题包按文件替换：在应用目录（开发时为仓库根目录）放置包含 `fonts/` 和 `sounds/` 的 `theme-pack/` 目录，缺少的文件回退到内置资源。本仓库不包含任何主题包内容。

## 鸣谢

- [kldhsh123](https://github.com/kldhsh123) 的 [scpsl-map-seed](https://github.com/kldhsh123/scpsl-map-seed)：根据种子还原设施布局的地图生成器，小地图的房间布局来自它。

## 许可证

[GPL-3.0-or-later](LICENSE)；协议包 [`packages/protocol`](packages/protocol) 为 [MIT](packages/protocol/LICENSE)。第三方资源见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
