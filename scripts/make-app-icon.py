# Makes the App Store icon from the small leaf logo: assets/images/icon.png (1024x1024, square, RGB, no transparency)
# and assets/images/icon-foreground.png (Android adaptive icon, transparent).
# The leaf is rebuilt crisply from the 348px logo (assets/images/logo-icon.png), filled with the logo own green, on white.
# Run: python scripts/make-app-icon.py      (needs Pillow)
import os
from PIL import Image, ImageFilter, ImageChops

root = os.path.join(os.path.dirname(__file__), '..')
src = Image.open(os.path.join(root, 'assets/images/logo-icon.png')).convert('RGB')  # the 348px logo: green leaf on near-white

# Leaf colour: the middle of the clearly green pixels.
green_px = sorted([p for p in src.getdata() if p[1] - p[2] > 60], key=sum)
green = green_px[len(green_px) // 2]

# How green each pixel is (0 = background, 255 = leaf), from the blue channel which the leaf lacks.
blue = src.split()[2]
low = green[2]
soft = blue.point(lambda v: max(0, min(255, int((250 - v) * 255 / max(1, 250 - low)))))
bbox = soft.point(lambda v: 255 if v > 100 else 0).getbbox()
soft = soft.crop(bbox)

# Crisp, smooth mask: scale up, blur a little, then cut at the halfway point.
SCALE = 12
big = soft.resize((soft.width * SCALE, soft.height * SCALE), Image.BICUBIC).filter(ImageFilter.GaussianBlur(SCALE * 0.6))
mask = big.point(lambda v: 255 if v >= 128 else 0)


def place(canvas_size, leaf_fraction):
    """Mask scaled so the leaf's longest side is leaf_fraction of the canvas, centred."""
    longest = max(mask.size)
    target = int(canvas_size * leaf_fraction)
    m = mask.resize((round(mask.width * target / longest), round(mask.height * target / longest)), Image.LANCZOS)
    full = Image.new('L', (canvas_size, canvas_size), 0)
    full.paste(m, ((canvas_size - m.width) // 2, (canvas_size - m.height) // 2))
    return full


S = 1024
icon = Image.new('RGB', (S, S), (255, 255, 255))
icon.paste(Image.new('RGB', (S, S), green), (0, 0), place(S, 0.58))
icon.save(os.path.join(root, 'assets/images/icon.png'), 'PNG')

fg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
fg.paste(Image.new('RGBA', (S, S), green + (255,)), (0, 0), place(S, 0.46))
fg.save(os.path.join(root, 'assets/images/icon-foreground.png'), 'PNG')
print('green', green, 'icon', icon.size, icon.mode)
