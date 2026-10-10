# Changelog

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
