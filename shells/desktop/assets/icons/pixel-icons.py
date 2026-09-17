# SPDX-License-Identifier: GPL-3.0-only
"""Original Classic 98 pixel artwork, drawn on separate 16 and 32 px grids.

python3 shells/desktop/assets/icons/pixel-icons.py
Requires Pillow only for this offline bake; 64 px is nearest-neighbour 32 px.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
from objects import SUBJECTS
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
    elif name == "media-player":
        player(9, 2, 14, 28)
    elif name == "disk":
        polygon([(2,15),(8,8),(28,8),(30,22),(26,26),(2,26)],"ink")
        polygon([(3,15),(9,9),(27,9),(29,21),(3,21)],"light")
        rect((3,22,25,3),"grey"); rect((5,23,15,1),"dark"); rect((25,23,2,1),"blue")
        polygon([(10,11),(21,11),(23,15),(8,15)],"white")
    elif name == "home":
        rect((6,13,21,16),"ink"); rect((7,14,19,14),"paper")
        rect((21,4,3,8),"dark")
        polygon([(2,14),(16,2),(30,14),(28,16),(16,6),(4,16)],"ink")
        polygon([(3,14),(16,3),(29,14),(28,14),(16,5),(4,15)],"gold")
        rect((11,18,6,10),"navy"); rect((20,17,4,5),"blue"); rect((15,23,1,1),"white")
    elif name == "desktop-place":
        device(2,3,28,21); rect((5,6,21,14),"ink"); rect((6,7,19,12),"navy")
        rect((7,8,17,1),"blue"); rect((13,24,6,3),"dark"); device(7,27,19,3)
    elif name in ("documents-place","document-file"):
        if name == "documents-place":
            rect((9,2,18,26),"ink"); rect((10,3,16,24),"light")
        polygon([(5,5),(19,5),(24,10),(24,30),(5,30)],"ink")
        polygon([(6,6),(18,6),(18,11),(23,11),(23,29),(6,29)],"white")
        polygon([(19,6),(23,10),(19,10)],"grey")
        for y in (14,17,20,23): rect((9,y,11,1),"dark")
    elif name == "downloads":
        device(2,23,28,6)
        polygon([(12,2),(20,2),(20,14),(27,14),(16,25),(5,14),(12,14)],"ink")
        polygon([(13,3),(19,3),(19,15),(24,15),(16,23),(8,15),(13,15)],"blue")
        rect((13,3,1,12),"cyan")
    elif name in ("native-apps","pocket-apps"):
        polygon([(3,5),(24,2),(29,6),(29,28),(7,31),(3,27)],"ink")
        polygon([(4,6),(23,3),(23,26),(4,28)],"navy")
        polygon([(24,4),(28,7),(28,27),(24,29)],"blue")
        if name == "pocket-apps":
            device(7,10,14,14); rect((9,12,10,2),"navy"); rect((9,16,10,6),"white")
        else:
            polygon([(11,9),(14,9),(20,23),(17,24)],"white")
            polygon([(16,8),(19,9),(10,25),(7,24)],"yellow")
            rect((10,18,8,2),"grey")
    elif name == "trash":
        polygon([(5,5),(27,5),(25,28),(22,30),(10,30),(7,28)],"ink")
        polygon([(6,6),(26,6),(24,27),(21,29),(11,29),(8,27)],"grey")
        for x in (10,14,18,22): rect((x,8,1,18),"dark")
        for y in (10,15,20,25): rect((8,y,16,1),"light")
        rect((5,4,22,3),"white"); rect((7,5,18,1),"dark")
    elif name == "openstrike":
        polygon([(3,14),(5,6),(11,2),(21,2),(27,7),(29,16),(26,22),(6,22)],"ink")
        polygon([(4,14),(6,7),(11,3),(21,3),(26,8),(28,15),(25,20),(7,20)],"gold")
        polygon([(6,11),(8,7),(12,5),(21,5),(24,8),(25,11)],"grey")
        rect((3,13,26,3),"ink"); rect((7,16,18,7),"ink")
        rect((8,17,7,4),"dark"); rect((17,17,7,4),"dark")
        rect((8,17,6,1),"light"); rect((17,17,6,1),"light")
        rect((6,23,3,6),"dark"); rect((24,23,3,6),"dark"); rect((22,27,5,3),"grey")
    elif name == "mines":
        polygon([(8,7),(22,7),(27,12),(27,24),(22,29),(9,29),(4,24),(4,12)],"ink")
        polygon([(9,8),(21,8),(25,13),(25,23),(21,27),(10,27),(6,23),(6,13)],"dark")
        rect((10,10,7,5),"grey"); rect((11,10,4,2),"white")
        rect((13,3,5,6),"ink"); rect((1,16,6,4),"ink"); rect((25,16,6,4),"ink")
        rect((24,3,4,4),"yellow")
    return image


if __name__ == "__main__":
    for name in ("files", "devices", "handheld", "media-player", *SUBJECTS):
        for size in (16, 32):
            image = draw_icon(name, size)
            image.save(HERE / f"classic-{name}-{size}.png", optimize=True)
            if size == 32:
                image.resize((64, 64), Image.Resampling.NEAREST).save(HERE / f"classic-{name}-64.png", optimize=True)
