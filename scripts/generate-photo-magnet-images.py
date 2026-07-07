from __future__ import annotations

import math
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "generated-products" / "photo-magnets"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default()


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def add_shadow(base, box, radius=28, offset=(18, 22), alpha=70):
    x, y, w, h = box
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(shadow)
    d.rounded_rectangle((x + offset[0], y + offset[1], x + w + offset[0], y + h + offset[1]), radius=radius, fill=(0, 0, 0, alpha))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    base.alpha_composite(shadow)


def sample_scene(kind: str, size):
    source_by_kind = {
        "vacation": "https://unsplash.com/photos/p6gB5tEc1dA/download?force=true&w=1400",
        "family": "https://unsplash.com/photos/WvVyudMd1Es/download?force=true&w=1400",
        "friends": "https://unsplash.com/photos/jCEpN62oWL4/download?force=true&w=1400",
    }
    source = source_by_kind.get(kind, source_by_kind["vacation"])
    cache_dir = OUT_DIR / "_source_photos"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{kind}-people-photo.jpg"
    try:
        if not cache_path.exists():
            request = urllib.request.Request(source, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(request, timeout=30) as response:
                cache_path.write_bytes(response.read())
        photo = Image.open(cache_path).convert("RGBA")
        photo_ratio = photo.width / photo.height
        target_ratio = size[0] / size[1]
        focus_by_kind = {
            "vacation": (0.82, 0.55),
            "family": (0.5, 0.5),
            "friends": (0.53, 0.5),
        }
        focus_x, focus_y = focus_by_kind.get(kind, (0.5, 0.5))
        if photo_ratio > target_ratio:
            new_w = int(photo.height * target_ratio)
            left = int(photo.width * focus_x - new_w / 2)
            left = max(0, min(left, photo.width - new_w))
            photo = photo.crop((left, 0, left + new_w, photo.height))
        else:
            new_h = int(photo.width / target_ratio)
            top = int(photo.height * focus_y - new_h / 2)
            top = max(0, min(top, photo.height - new_h))
            photo = photo.crop((0, top, photo.width, top + new_h))
        photo = photo.resize(size, Image.Resampling.LANCZOS)
        return photo
    except Exception:
        pass

    w, h = size
    img = Image.new("RGBA", size, (255, 255, 255, 255))
    d = ImageDraw.Draw(img)

    if kind == "vacation":
        for y in range(h):
            t = y / max(1, h - 1)
            r = int(120 + 95 * t)
            g = int(190 + 30 * t)
            b = int(235 - 25 * t)
            d.line((0, y, w, y), fill=(r, g, b, 255))
        d.rectangle((0, int(h * 0.48), w, h), fill=(52, 154, 195, 255))
        d.polygon([(0, int(h * 0.55)), (w, int(h * 0.46)), (w, h), (0, h)], fill=(238, 210, 142, 255))
        d.ellipse((w * 0.72, h * 0.09, w * 0.89, h * 0.24), fill=(255, 224, 93, 255))
        for x in range(-30, w, 78):
            d.arc((x, h * 0.5, x + 90, h * 0.62), 200, 340, fill=(245, 255, 255, 170), width=4)
        for cx, scale, color in [(w * 0.36, 1.0, (30, 85, 75)), (w * 0.51, 0.85, (44, 105, 95))]:
            cy = h * 0.72
            d.ellipse((cx - 8 * scale, cy - 36 * scale, cx + 8 * scale, cy - 20 * scale), fill=color)
            d.line((cx, cy - 20 * scale, cx, cy + 16 * scale), fill=color, width=max(2, int(4 * scale)))
            d.line((cx, cy - 5 * scale, cx - 18 * scale, cy + 10 * scale), fill=color, width=max(2, int(3 * scale)))
            d.line((cx, cy - 5 * scale, cx + 18 * scale, cy + 10 * scale), fill=color, width=max(2, int(3 * scale)))
    elif kind == "family":
        for y in range(h):
            t = y / max(1, h - 1)
            d.line((0, y, w, y), fill=(int(210 - 40 * t), int(235 - 30 * t), int(218 - 70 * t), 255))
        d.rectangle((0, h * 0.58, w, h), fill=(96, 162, 100, 255))
        for cx in [w * 0.12, w * 0.28, w * 0.76, w * 0.9]:
            d.rectangle((cx - 6, h * 0.28, cx + 6, h * 0.62), fill=(95, 84, 51, 255))
            d.ellipse((cx - 48, h * 0.12, cx + 48, h * 0.38), fill=(56, 132, 76, 255))
        d.rounded_rectangle((w * 0.25, h * 0.68, w * 0.75, h * 0.9), radius=12, fill=(236, 190, 120, 255))
        people = [(w * 0.36, h * 0.64, (42, 83, 130)), (w * 0.49, h * 0.62, (180, 82, 93)), (w * 0.61, h * 0.65, (70, 115, 80))]
        for cx, cy, color in people:
            d.ellipse((cx - 10, cy - 34, cx + 10, cy - 14), fill=(99, 67, 47, 255))
            d.rounded_rectangle((cx - 15, cy - 15, cx + 15, cy + 38), radius=8, fill=color + (255,))
    else:
        for y in range(h):
            t = y / max(1, h - 1)
            d.line((0, y, w, y), fill=(int(245 - 30 * t), int(224 - 40 * t), int(236 - 20 * t), 255))
        d.ellipse((w * 0.1, h * 0.08, w * 0.92, h * 0.86), fill=(244, 191, 210, 255))
        d.ellipse((w * 0.18, h * 0.18, w * 0.82, h * 0.78), fill=(185, 222, 239, 255))
        d.rectangle((0, h * 0.62, w, h), fill=(110, 167, 118, 255))
        friends = [(w * 0.33, h * 0.56, (238, 132, 87)), (w * 0.5, h * 0.53, (70, 120, 190)), (w * 0.67, h * 0.57, (163, 88, 170))]
        for cx, cy, color in friends:
            d.ellipse((cx - 13, cy - 44, cx + 13, cy - 18), fill=(91, 61, 41, 255))
            d.rounded_rectangle((cx - 18, cy - 19, cx + 18, cy + 52), radius=10, fill=color + (255,))
            d.line((cx - 18, cy + 2, cx - 44, cy + 12), fill=color + (255,), width=6)
            d.line((cx + 18, cy + 2, cx + 44, cy + 12), fill=color + (255,), width=6)

    return img


def draw_magnet(name: str, panel_size, scene_kind: str, label: str):
    canvas = Image.new("RGBA", (1000, 1200), (248, 246, 238, 255))
    d = ImageDraw.Draw(canvas)

    pw, ph = panel_size
    px = (1000 - pw) // 2
    py = 140 if ph > 700 else 225
    add_shadow(canvas, (px, py, pw, ph), radius=38)

    panel = Image.new("RGBA", panel_size, (255, 255, 255, 0))
    pd = ImageDraw.Draw(panel)
    pd.rounded_rectangle((0, 0, pw - 1, ph - 1), radius=36, fill=(248, 252, 255, 104), outline=(213, 222, 218, 210), width=5)
    pd.rounded_rectangle((10, 10, pw - 11, ph - 11), radius=28, outline=(255, 255, 255, 155), width=3)

    margin_x = int(pw * 0.105)
    margin_y = int(ph * 0.095)
    photo_box = (margin_x, margin_y, pw - margin_x, ph - margin_y)
    photo_w = photo_box[2] - photo_box[0]
    photo_h = photo_box[3] - photo_box[1]
    photo = sample_scene(scene_kind, (photo_w, photo_h))
    # Slight scallop on print edge for a handmade sample-photo feel.
    photo_mask = Image.new("L", (photo_w, photo_h), 255)
    md = ImageDraw.Draw(photo_mask)
    step = 24
    for y in range(0, photo_h, step):
        md.pieslice((-10, y, 16, y + step), -90, 90, fill=0)
        md.pieslice((photo_w - 16, y, photo_w + 10, y + step), 90, 270, fill=0)
    panel.alpha_composite(photo, (photo_box[0], photo_box[1]))
    pd = ImageDraw.Draw(panel)
    for cx, cy in [(32, 32), (pw - 32, 32), (32, ph - 32), (pw - 32, ph - 32)]:
        pd.ellipse((cx - 18, cy - 18, cx + 18, cy + 18), fill=(213, 207, 178, 255), outline=(126, 124, 105, 180), width=2)
        pd.ellipse((cx - 11, cy - 11, cx + 11, cy + 11), fill=(232, 229, 205, 255))

    panel = panel.filter(ImageFilter.UnsharpMask(radius=1, percent=110, threshold=3))
    canvas.alpha_composite(panel, (px, py))

    d = ImageDraw.Draw(canvas)
    d.text((500, py + ph + 62), label, anchor="mm", fill=(25, 53, 31, 255), font=font(34, bold=True))
    d.text((500, py + ph + 104), "Personalised acrylic photo magnet", anchor="mm", fill=(109, 127, 95, 255), font=font(22))
    return canvas.convert("RGB")


def main():
    products = [
        ("photo-magnet-9x6.png", (520, 780), "vacation", "9 x 6 cm"),
        ("photo-magnet-10x7-5.png", (560, 747), "family", "10 x 7.5 cm"),
        ("photo-magnet-8x8.png", (650, 650), "friends", "8 x 8 cm"),
    ]
    for file_name, panel, scene, label in products:
        out = OUT_DIR / file_name
        draw_magnet(file_name, panel, scene, label).save(out, quality=92)
        print(out)


if __name__ == "__main__":
    main()
