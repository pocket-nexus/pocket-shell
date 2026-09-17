# SPDX-License-Identifier: GPL-3.0-only
"""Original Classic 98 pixel artwork, drawn on separate 16 and 32 px grids.

python3 shells/desktop/assets/icons/pixel-icons.py
Requires Pillow only for this offline bake; 64 px is nearest-neighbour 32 px.
"""
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
PALETTE = {
    "ink": "#000000", "dark": "#808080", "grey": "#c0c0c0",
    "light": "#dfdfdf", "white": "#ffffff", "navy": "#000080",
    "blue": "#008080", "cyan": "#00ffff", "gold": "#808000",
    "yellow": "#ffff80", "paper": "#ffffdf",
}


def draw_icon(name, size):
    image = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(image)
    scale = size / 32

    def rect(box, color):
        x, y, w, h = box
        left, top = round(x * scale), round(y * scale)
        right = max(left, round((x + w) * scale) - 1)
        bottom = max(top, round((y + h) * scale) - 1)
        draw.rectangle((left, top, right, bottom), fill=PALETTE[color])

    def polygon(points, fill):
        draw.polygon([(round(x * scale), round(y * scale)) for x, y in points], fill=PALETTE[fill])

    def device(x, y, w, h):
        rect((x, y, w, h), "ink")
        rect((x + 1, y + 1, w - 2, h - 2), "grey")
        rect((x + 1, y + 1, w - 3, 1), "white")
        rect((x + 1, y + 1, 1, h - 3), "white")
        rect((x + w - 2, y + 2, 1, h - 3), "dark")
        rect((x + 2, y + h - 2, w - 3, 1), "dark")

    def player(x, y, w=12, h=25):
        device(x, y, w, h)
        rect((x + 3, y + 4, w - 6, h - 10), "navy")
        rect((x + 4, y + 5, w - 8, h - 13), "blue")
        if size == 32:
            rect((x + 4, y + 5, w - 8, 1), "cyan")
        rect((x + w // 2 - 1, y + h - 5, 3, 2), "dark")
        rect((x + w // 2, y + h - 5, 1, 1), "white")

    def handheld(x, y, w=29, h=16):
        device(x, y, w, h)
        rect((x + 7, y + 3, w - 14, h - 6), "navy")
        rect((x + 8, y + 4, w - 16, h - 8), "blue")
        if size == 32:
            rect((x + 8, y + 4, w - 16, 1), "cyan")
            rect((x + 3, y + h - 5, 2, 2), "dark")
        rect((x + 2, y + 6, 5, 2), "ink")
        rect((x + 3, y + 5, 2, 4), "ink")
        rect((x + w - 5, y + 5, 2, 2), "navy")
        rect((x + w - 3, y + 8, 2, 2), "navy")

    if name == "files":
        polygon([(2, 8), (3, 5), (12, 5), (15, 8), (28, 8), (28, 26), (2, 26)], "ink")
        polygon([(3, 8), (4, 6), (11, 6), (14, 9), (27, 9), (27, 25), (3, 25)], "gold")
        rect((6, 10, 19, 15), "dark")
        rect((7, 8, 18, 15), "white")
        rect((8, 9, 16, 13), "paper")
        if size == 32:
            for y in (11, 13, 15): rect((10, y, 11, 1), "grey")
        polygon([(1, 14), (24, 14), (28, 27), (5, 27)], "ink")
        polygon([(2, 15), (23, 15), (26, 26), (6, 26)], "yellow")
        polygon([(3, 15), (22, 15), (22, 16), (4, 16)], "white")
        polygon([(6, 25), (25, 25), (26, 26), (6, 26)], "gold")
    elif name == "devices":
        player(17, 2, 12, 26)
        handheld(1, 15, 28, 15)
    elif name == "handheld":
        handheld(1, 8)
    else:
        player(9, 2, 14, 28)
    return image


if __name__ == "__main__":
    for name in ("files", "devices", "handheld", "media-player"):
        for size in (16, 32):
            image = draw_icon(name, size)
            image.save(HERE / f"classic-{name}-{size}.png", optimize=True)
            if size == 32:
                image.resize((64, 64), Image.Resampling.NEAREST).save(HERE / f"classic-{name}-64.png", optimize=True)
