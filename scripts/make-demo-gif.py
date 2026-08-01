#!/usr/bin/env python3
"""
Render docs/media/demo.gif from real flakesieve output.

The frames are drawn from actual CLI output captured against the synthetic
history that scripts/seed-demo.mjs produces — nothing here is mocked up, so the
GIF cannot drift away from what the tool really prints.

    npm run build
    node scripts/seed-demo.mjs .flakesieve/demo-history.json
    FORCE_COLOR=1 node dist/cli.js analyze \
        --report test/fixtures/demo-run.xml \
        --history .flakesieve/demo-history.json > /tmp/demo-out.txt
    python scripts/make-demo-gif.py /tmp/demo-out.txt docs/media/demo.gif

Requires Pillow and ffmpeg. Fonts are resolved from the system; override with
--font / --emoji-font on platforms where the defaults are absent.
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# GitHub dark, so the GIF sits comfortably in a README on either theme.
BG = (13, 17, 23)
CHROME = (22, 27, 34)
BORDER = (48, 54, 61)
DOTS = [(255, 95, 86), (255, 189, 46), (39, 201, 63)]

PALETTE = {
    "default": (201, 209, 217),
    "bold": (240, 246, 252),
    "dim": (110, 118, 129),
    "red": (255, 123, 114),
    "yellow": (227, 179, 65),
    "gray": (139, 148, 158),
}

CODE_TO_STYLE = {"1": "bold", "2": "dim", "31": "red", "33": "yellow", "90": "gray"}

ANSI = re.compile(r"\x1b\[([0-9;]*)m")

FONT_SIZE = 17
LINE_H = 25
PAD_X = 26
PAD_Y = 16
TITLE_H = 34
FPS = 15

PROMPT = "$ "
COMMAND = "npx flakesieve analyze"


def parse_ansi(line: str) -> list[tuple[str, str]]:
    """Split one line into (text, style-name) runs."""
    runs: list[tuple[str, str]] = []
    style = "default"
    pos = 0
    for m in ANSI.finditer(line):
        if m.start() > pos:
            runs.append((line[pos : m.start()], style))
        for code in (m.group(1) or "0").split(";"):
            style = "default" if code in ("", "0") else CODE_TO_STYLE.get(code, style)
        pos = m.end()
    if pos < len(line):
        runs.append((line[pos:], style))
    return runs


def is_emoji(ch: str) -> bool:
    o = ord(ch)
    return (
        0x1F300 <= o <= 0x1FAFF
        or 0x2600 <= o <= 0x27BF
        or o in (0x26AB, 0x2B1B, 0x26AA)
    )


def draw_runs(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    runs: list[tuple[str, str]],
    fonts: dict,
    cell: float,
) -> None:
    """Draw styled runs, switching to the colour-emoji font where needed."""
    for text, style in runs:
        colour = PALETTE[style]
        font = fonts["bold"] if style == "bold" else fonts["regular"]
        for ch in text:
            if ch == " ":
                x += cell
                continue
            if is_emoji(ch):
                # Emoji occupy two cells in a terminal, and need the colour font.
                draw.text(
                    (x, y - 2), ch, font=fonts["emoji"], embedded_color=True
                )
                x += cell * 2
            else:
                draw.text((x, y), ch, font=font, fill=colour)
                x += cell


def render_frame(
    lines: list[list[tuple[str, str]]],
    typed: str,
    size: tuple[int, int],
    fonts: dict,
    cell: float,
    cursor: bool,
) -> Image.Image:
    img = Image.new("RGBA", size, BG)
    draw = ImageDraw.Draw(img)

    draw.rectangle([0, 0, size[0], TITLE_H], fill=CHROME)
    draw.line([0, TITLE_H, size[0], TITLE_H], fill=BORDER)
    for i, colour in enumerate(DOTS):
        cx = 18 + i * 18
        draw.ellipse([cx - 5, TITLE_H // 2 - 5, cx + 5, TITLE_H // 2 + 5], fill=colour)

    y = TITLE_H + PAD_Y
    prompt_runs = [(PROMPT, "gray"), (typed, "default")]
    draw_runs(draw, PAD_X, y, prompt_runs, fonts, cell)
    if cursor:
        cx = PAD_X + cell * (len(PROMPT) + len(typed))
        draw.rectangle([cx, y + 1, cx + cell - 1, y + FONT_SIZE + 3], fill=PALETTE["dim"])

    for i, runs in enumerate(lines):
        draw_runs(draw, PAD_X, y + LINE_H * (i + 1), runs, fonts, cell)

    return img.convert("RGB")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("capture", type=Path, help="CLI output captured with FORCE_COLOR=1")
    ap.add_argument("out", type=Path)
    ap.add_argument("--font", default=r"C:\Windows\Fonts\consola.ttf")
    ap.add_argument("--bold-font", default=r"C:\Windows\Fonts\consolab.ttf")
    ap.add_argument("--emoji-font", default=r"C:\Windows\Fonts\seguiemj.ttf")
    args = ap.parse_args()

    if not shutil.which("ffmpeg"):
        print("ffmpeg is required", file=sys.stderr)
        return 1

    fonts = {
        "regular": ImageFont.truetype(args.font, FONT_SIZE),
        "bold": ImageFont.truetype(args.bold_font, FONT_SIZE),
        "emoji": ImageFont.truetype(args.emoji_font, FONT_SIZE - 2),
    }
    cell = fonts["regular"].getlength("M")

    raw = args.capture.read_text(encoding="utf-8").rstrip("\n").split("\n")
    lines = [parse_ansi(l) for l in raw]

    widest = max(
        (sum(2 if is_emoji(c) else 1 for t, _ in runs for c in t) for runs in lines),
        default=40,
    )
    widest = max(widest, len(PROMPT) + len(COMMAND))
    size = (
        int(PAD_X * 2 + cell * (widest + 2)),
        TITLE_H + PAD_Y * 2 + LINE_H * (len(lines) + 1),
    )

    frames: list[Image.Image] = []

    def add(img: Image.Image, times: int = 1) -> None:
        frames.extend([img] * times)

    # Type the command.
    for i in range(len(COMMAND) + 1):
        add(render_frame([], COMMAND[:i], size, fonts, cell, True), 1)
    add(frames[-1], 6)

    # Reveal the report a line at a time.
    for i in range(1, len(lines) + 1):
        add(render_frame(lines[:i], COMMAND, size, fonts, cell, False), 2)

    add(frames[-1], 40)

    with tempfile.TemporaryDirectory() as tmp:
        for i, frame in enumerate(frames):
            frame.save(Path(tmp) / f"f{i:04d}.png")

        args.out.parent.mkdir(parents=True, exist_ok=True)
        palette = Path(tmp) / "palette.png"
        common = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS)]
        subprocess.run(
            [*common, "-i", f"{tmp}/f%04d.png",
             "-vf", "palettegen=max_colors=128:stats_mode=diff", str(palette)],
            check=True,
        )
        subprocess.run(
            [*common, "-i", f"{tmp}/f%04d.png", "-i", str(palette),
             "-lavfi", "paletteuse=dither=bayer:bayer_scale=3",
             "-loop", "0", str(args.out)],
            check=True,
        )

    kb = args.out.stat().st_size / 1024
    print(f"{args.out} · {size[0]}x{size[1]} · {len(frames)} frames · {kb:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
