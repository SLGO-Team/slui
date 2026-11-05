# 执行清单

1. 插件：分支 `feat/minimap-dev-export`，加 `MinimapDevExport.cs`（#if DEBUG），在 Plugin 里 DEBUG 下启停；
   `dotnet build -c Debug`、`dotnet build -c Release -p:RunAccessScan=true`（确认 Release 不含）、`dotnet test`。
2. 本机服务器：备份 `%APPDATA%/EXILED/Plugins/Slgo.dll`，放 Debug 构建；按四组环境变量各起一次 LocalAdmin 7777，
   等导出文件出现后结束进程；完成后还原 Slgo.dll。
3. 对比导出与旧夹具（预制体名集合、门口坐标、同种子布局）；差异逐条解释。
4. slui：替换两份夹具、改 README / PROVENANCE；`npm run lint`、`npm test`、`npm run build`；mock 预览截图对比。
5. 插件 CLAUDE.md（Sidecar 模块）记开发导出用法；插件分支本地合并 main；slui 开 PR。
