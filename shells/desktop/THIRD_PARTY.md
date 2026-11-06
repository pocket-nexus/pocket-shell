# Third-party notices

## PocketJS

`../../vendor/pocketjs` is a pinned Git submodule of
[pocket-nexus/pocketjs](https://github.com/pocket-nexus/pocketjs), licensed
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

## Portable text libraries

The pinned PocketJS text engine uses COSMIC Text, Harfrust and Swash for
text layout, shaping and glyph rasterization. These dependencies retain their
MIT and/or Apache-2.0 licenses as recorded by their Cargo package metadata and
locked dependency graph. Font data uses the separate OFL notices above.
