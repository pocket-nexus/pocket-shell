# Factory artwork

The pictures in this directory are M5Stack's, from
[M5Tab5-UserDemo](https://github.com/m5stack/M5Tab5-UserDemo) at commit
`fe8aa051beb9385468f7e46b909e764169df3f7a` (`app/assets/images/*.c`),
under the MIT license in [LICENSE](LICENSE), Copyright (c) 2025 M5Stack
Technology CO LTD.

`tools/tab5-demo-art.ts` writes them from a checkout of that repository:

```sh
bun tools/tab5-demo-art.ts /path/to/M5Tab5-UserDemo
```

It decodes each LVGL image (RGB565, or RGB565A8 with an alpha plane),
halves it with a 2x2 box filter for the 640x360 surface and pads it to
power-of-two sides with opaque black, since a pak image has power-of-two
sides of at most 512 and a PSM_5650 entry refuses alpha. The app draws each
picture inside a clip of its own size (`Img` in `ui.tsx`). The 1280x720
launcher picture becomes four tiles of the 640x360 picture:

| File | Region | Texture |
| --- | --- | --- |
| `bg_00.png` | 0,0 512x256 | 512x256 |
| `bg_10.png` | 512,0 128x256 | 128x256 |
| `bg_01.png` | 0,256 512x104 | 512x128 |
| `bg_11.png` | 512,256 128x104 | 128x128 |

`images.json` stores the opaque pictures as PSM_5650 (2 bytes a pixel).
