# Changelog

## [0.8.0](https://github.com/SLGO-Team/slui/compare/v0.7.0...v0.8.0) (2026-10-21)


### Features

* **hud:** CS2 spectator panel while watching a player ([#48](https://github.com/SLGO-Team/slui/issues/48)) ([4015033](https://github.com/SLGO-Team/slui/commit/4015033b2d9f7d2b49dd91e6a3a4ebae3406d06c))
* **overlay:** 16:10 and 4:3 layouts follow Panorama's height scaling ([#37](https://github.com/SLGO-Team/slui/issues/37)) ([7901ae5](https://github.com/SLGO-Team/slui/commit/7901ae526a3be042b4b730d7d629ba8c92201b73))
* **overlay:** own world blur under the scoreboard and shop mask ([#46](https://github.com/SLGO-Team/slui/issues/46)) ([ce67cdc](https://github.com/SLGO-Team/slui/commit/ce67cdc0164445cb307d93d424e5ecdbaeb9b3bd))
* **overlay:** world blur under the remaining HUD panels ([#47](https://github.com/SLGO-Team/slui/issues/47)) ([3841269](https://github.com/SLGO-Team/slui/commit/3841269d8a95a37d0d1efb1b8110891af32d79d1))
* **protocol:** scoreboard.snapshot event and scoreboard client feature ([#42](https://github.com/SLGO-Team/slui/issues/42)) ([cbe895f](https://github.com/SLGO-Team/slui/commit/cbe895f0fad533ed81baab8612007a2617bae64f))
* **scoreboard:** CS2 scoreboard on a held key with cursor mode, sorting and stat pages ([#44](https://github.com/SLGO-Team/slui/issues/44)) ([e24cc02](https://github.com/SLGO-Team/slui/commit/e24cc022e8868daa8de75cdabb7d3de8d96238a6))
* **updater:** one-click auto-update ([#43](https://github.com/SLGO-Team/slui/issues/43)) ([603e41a](https://github.com/SLGO-Team/slui/commit/603e41a4bfd3412f8c1dc853c91e65348f071d34))


### Bug Fixes

* **minimap:** team-coloured radar frame, no overview caption, hidden offline ([#39](https://github.com/SLGO-Team/slui/issues/39)) ([0560fd7](https://github.com/SLGO-Team/slui/commit/0560fd7607a6d9b5a7e6e7f9ebf343945e32bb40))
* **shop,hudmessages:** team-colour balance, navbar and hint bars; drop pause/pending labels ([#40](https://github.com/SLGO-Team/slui/issues/40)) ([54ea412](https://github.com/SLGO-Team/slui/commit/54ea412f469503390c31fa8ba84c933ed4321338))
* **shop:** buy-menu mask covers the HUD panels, as in CS2's hud.xml ([#41](https://github.com/SLGO-Team/slui/issues/41)) ([beceeb5](https://github.com/SLGO-Team/slui/commit/beceeb5e6b2c015f5762aaf4a502586fd086b1eb))
* **updater:** manage the updater state before the windows are built ([#45](https://github.com/SLGO-Team/slui/issues/45)) ([3f92954](https://github.com/SLGO-Team/slui/commit/3f92954b057942a33d49f3150380a334c91a0ff3))

## [0.7.0](https://github.com/SLGO-Team/slui/compare/v0.6.0...v0.7.0) (2026-10-18)


### Features

* **killfeed:** CS2 top-right killfeed from hud.killfeed ([#35](https://github.com/SLGO-Team/slui/issues/35)) ([14d1e1c](https://github.com/SLGO-Team/slui/commit/14d1e1c73a197befe89b940a96a112b308696f16))
* **minimap:** v6 renders the plugin's actual room layout ([#33](https://github.com/SLGO-Team/slui/issues/33)) ([c1cd15f](https://github.com/SLGO-Team/slui/commit/c1cd15fb727a03a33a544e3c83255643550a76cf))

## [0.6.0](https://github.com/SLGO-Team/slui/compare/v0.5.0...v0.6.0) (2026-10-14)


### Features

* **session:** show why a server instance ended ([#32](https://github.com/SLGO-Team/slui/issues/32)) ([80bb335](https://github.com/SLGO-Team/slui/commit/80bb33534575075cdb405cab9215da6f405b7a62))
* **sidecar:** 经 Rust 层不发 SNI 连接 sidecar ([#30](https://github.com/SLGO-Team/slui/issues/30)) ([e9ed66a](https://github.com/SLGO-Team/slui/commit/e9ed66a9827f5fcab1c8763d04eb14a8833a4ba4))


### Bug Fixes

* **session:** show an ended server instance as restarting ([#31](https://github.com/SLGO-Team/slui/issues/31)) ([c086c40](https://github.com/SLGO-Team/slui/commit/c086c40d5a6b31de21299e8ec467a8ce9667a465))


### Performance Improvements

* **ci:** slimmer debug info for the CI Rust cache ([#27](https://github.com/SLGO-Team/slui/issues/27)) ([ddf24d8](https://github.com/SLGO-Team/slui/commit/ddf24d89fcc47e4877f75e7134b88f92b4bb35cf))
* **installer:** build slui-setup once for the installer and the uninstaller ([#29](https://github.com/SLGO-Team/slui/issues/29)) ([516c1f2](https://github.com/SLGO-Team/slui/commit/516c1f25e8c78a9ea96fe9b4826f0c411680c985))

## [0.5.0](https://github.com/SLGO-Team/slui/compare/v0.4.0...v0.5.0) (2026-10-10)


### Features

* **bottomhud:** CS2-style bottom HUD with balance, ammo and kill cards ([#21](https://github.com/SLGO-Team/slui/issues/21)) ([aa54162](https://github.com/SLGO-Team/slui/commit/aa54162d0fdbe0f37f89a76fdb63a2995de7ddda))


### Bug Fixes

* **bottomhud:** clip each odometer symbol to its row ([#23](https://github.com/SLGO-Team/slui/issues/23)) ([3c17b4b](https://github.com/SLGO-Team/slui/commit/3c17b4ba3d360d4688806db650a1e3019abd76c6))
* **session:** clear the overlay when the server instance ends ([#26](https://github.com/SLGO-Team/slui/issues/26)) ([8cf9e39](https://github.com/SLGO-Team/slui/commit/8cf9e39746f5fe0f6dcd508919800fe04aeb7c3a))
* **shop:** teammate holder pips and CS2 failure banner ([#25](https://github.com/SLGO-Team/slui/issues/25)) ([3b0f6b9](https://github.com/SLGO-Team/slui/commit/3b0f6b98ac8dd712675f72297deaae1f8328e674))

## [0.4.0](https://github.com/SLGO-Team/slui/compare/v0.3.0...v0.4.0) (2026-10-06)


### Features

* **hudmessages:** render CS2 bottom-centre alerts and hints ([#16](https://github.com/SLGO-Team/slui/issues/16)) ([3cba3ab](https://github.com/SLGO-Team/slui/commit/3cba3ab31e83431a2984109ab1a6a3ece8fed21b))
* **hudmessages:** render the CS2 generator progress card and take over the message zone ([#17](https://github.com/SLGO-Team/slui/issues/17)) ([2cd1b57](https://github.com/SLGO-Team/slui/commit/2cd1b57bbd157db0aa406a1190d2d36d8a960ccc))
* **hudmessages:** show the generator overload countdown in the high hint slot ([#20](https://github.com/SLGO-Team/slui/issues/20)) ([87602aa](https://github.com/SLGO-Team/slui/commit/87602aa1efaebe0130138171cf892d32faac0e56))
* **protocol:** add hud.messages and round.result events ([#13](https://github.com/SLGO-Team/slui/issues/13)) ([66edd65](https://github.com/SLGO-Team/slui/commit/66edd657d6e3c3f4b63e838a7f7ff24fa97e4bc2))
* **winpanel:** render the CS2 round result panel with MVP ([#15](https://github.com/SLGO-Team/slui/issues/15)) ([c41fd27](https://github.com/SLGO-Team/slui/commit/c41fd277acf407a3ef058a91ebf45c053d348687))


### Bug Fixes

* **hud:** show CS2's red pause glyph on the timer during a tactical pause ([#18](https://github.com/SLGO-Team/slui/issues/18)) ([9c4bb5f](https://github.com/SLGO-Team/slui/commit/9c4bb5f5d1dacbd472dd824966754bbda4578e47))

## [0.3.0](https://github.com/SLGO-Team/slui/compare/v0.2.2...v0.3.0) (2026-10-05)


### Features

* **installer:** add a branded uninstaller with optional theme pack removal ([#12](https://github.com/SLGO-Team/slui/issues/12)) ([38de6cd](https://github.com/SLGO-Team/slui/commit/38de6cd8c85c5fb53be896a4603ea692dacd56ab))


### Bug Fixes

* **minimap:** play poses out on the plugin's capture timeline ([#11](https://github.com/SLGO-Team/slui/issues/11)) ([6e28557](https://github.com/SLGO-Team/slui/commit/6e285573e9952050237693da3fde32f0f6ebc760))
* **minimap:** rotate the heading-up map smoothly ([#9](https://github.com/SLGO-Team/slui/issues/9)) ([8f497de](https://github.com/SLGO-Team/slui/commit/8f497de7e4bbf6f4fe959473b77da24986f26667))

## [0.2.2](https://github.com/SLGO-Team/slui/compare/v0.2.1...v0.2.2) (2026-10-04)


### Bug Fixes

* **session:** keep the last status during background retries ([#5](https://github.com/SLGO-Team/slui/issues/5)) ([7b64a60](https://github.com/SLGO-Team/slui/commit/7b64a6031c5d95ff2f802c2b8f38789f7ca07ffa))

## [0.2.1](https://github.com/SLGO-Team/slui/compare/v0.2.0...v0.2.1) (2026-10-04)


### Performance Improvements

* **build:** share one Cargo workspace between SLUI and the installer shell ([#3](https://github.com/SLGO-Team/slui/issues/3)) ([83f2f20](https://github.com/SLGO-Team/slui/commit/83f2f203d8f99cd432eb076bdeac78e78b5e7ba9))

## [0.2.0](https://github.com/SLGO-Team/slui/compare/v0.1.0...v0.2.0) (2026-10-04)


### Features

* add CI, release workflow and installer --theme-pack option ([#1](https://github.com/SLGO-Team/slui/issues/1)) ([60d23ff](https://github.com/SLGO-Team/slui/commit/60d23ff9c59f9276472144d1496c2f63646a14d2))
