# 安全：按窗口拆分 capability

## Goal

overlay 窗口只能调用它真正需要的自定义命令；只有 home 能做提权重启、更新、保存设置、打开日志。

## Requirements

- 现状：两个窗口共用 `capabilities/default.json`，`build.rs` 没有 app manifest，所以全部自定义命令对 overlay 也开放。
- 在 `build.rs` 用 `tauri_build::Attributes::new().app_manifest(AppManifest::new().commands(&[...]))` 声明命令，
  按窗口拆 capability：`relaunch_elevated`、`updater_*`、`save_settings`、`reveal_log_file` 只给 home。
- `relaunch.rs` 里再检查调用方窗口的 label 是 `"home"`（纵深防御）。
- 其他命令按两个窗口实际调用的情况分配，不多给。

## Acceptance Criteria

- [x] 每个自定义命令都在 manifest 里，capability 按窗口列出；overlay 调 home 专属命令会被拒绝。
- [x] home 和 overlay 现有功能（mock、tauri:build:local）不受影响。
- [x] cargo clippy `-D warnings`、workspace 测试、`npm test` 通过。

## 实现说明

- 设计见 design.md；`core:default` 也一并收窄为实际用到的权限。
- 验证（2026-11-04，`tauri build --no-bundle` local 配置 + 独立 identifier + CDP）：两个窗口启动无 ACL 报错；
  逐个以空参数调用全部 31 个命令：overlay 调 home 专属的 7 个命令被拒，home 调 overlay 专属的 16 个被拒，
  其余只报参数错误（已通过 ACL）；两个窗口的 tray/image/窗口查询被拒；home 的拖动、最小化、
  双击标题栏仍可用，opener 只能打开项目地址。
