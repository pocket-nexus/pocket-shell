# Third-party notices

## macOS application icon

[AppIcon.icns](assets/macos/AppIcon.icns) is copied unchanged from SHERU's
`apps/macos/Sources/Sheru/Resources/AppIcon.icns`, at the project owner's request.
Source revision: `650a2710954dc951e84a665088f5e726325ecd44`.
SHA-256: `2d79a34419b16ddaac2539490a3138589b1fea64c15bdf82967305908d3c85d2`.
The bundle uses this file for its Finder and Dock icon; the build does not
require a SHERU checkout.

## PocketJS

`../../vendor/pocketjs` is a pinned Git submodule of
[pocket-stack/pocketjs](https://github.com/pocket-stack/pocketjs), licensed
under the MIT License. PocketJS remains a separate MIT dependency.

## Inter

`../../vendor/pocketjs/assets/fonts/Inter-Regular.ttf` and `Inter-Bold.ttf` are Inter
by Rasmus Andersson, licensed under the SIL Open Font License 1.1 (the received
license is in `../../vendor/pocketjs/assets/fonts/LICENSE.txt`). The XP and Aqua
themes generate the ignored atlases `src/system-ui/fonts/inter-22*.bin` and
`inter-23*.bin`; Windows XP's own Tahoma and Trebuchet MS and Mac OS X's Lucida
Grande are Microsoft's and Apple's respectively and are not redistributed here. Those baked atlases are derived Font Software and remain
under the OFL 1.1.

## W95FA

`assets/fonts/W95FA.otf` is W95FA by Alina Sava / FontsArena.com. It is
licensed under the SIL Open Font License 1.1. The complete received license is
in `assets/fonts/LICENSE-W95FA.txt`. The generated, ignored atlas files under
`src/system-ui/fonts` are derived Font Software and remain under the OFL 1.1.

## Portable text and native presentation libraries

The pinned PocketJS runtime uses COSMIC Text (0.19), Harfrust and Swash
for Rust text processing, winit and softbuffer for native window/pixel
presentation, and arboard for the clipboard. These dependencies retain their
MIT and/or Apache-2.0 licenses as recorded by their Cargo package metadata and
locked dependency graph. They retain those licenses in this GPL distribution. Font data continues to use the separate OFL notices above;
no macOS system fonts are redistributed.

## Optional OpenStrike game

The local macOS build can package OpenStrike from the configured checkout.
Its MIT license travels in `Resources/OpenStrike/LICENSE`; the bundled officer
model is authored by that project. The cooked Dust II map is a user-supplied
local input and is not part of this repository. An app built with that local
map is not a redistributable map download.
