# Makes the winter header picture for the Storm Details screen from the snow photo in assets/source/snow-panorama.jpg:
#   assets/images/snow-storm-header.jpg  (1290 x 740, a plain picture with no interface in it)
# The right-hand part of the photo (the snowy trees) is cropped and scaled to the header's shape, lifted slightly toward
# icy blue, faded to near-white on the left so the title stays readable, and faded into the page colour at the bottom
# so there is no hard edge. To use a different crop or photo, change the numbers below and run:
#   python scripts/make-storm-header.py        (needs Pillow)
import os
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

root = os.path.join(os.path.dirname(__file__), '..')
src = Image.open(os.path.join(root, 'assets/source/snow-panorama.jpg')).convert('RGB')
OUT_W, OUT_H = 1290, 740
PAGE = (241, 245, 249)        # the Snow theme's page background (#F1F5F9)
ICE = (214, 231, 245)         # a pale icy blue to lift the grey photo toward

# crop: keep the full height, take the right-hand trees; same shape as the header
ch = src.height
cw = round(ch * OUT_W / OUT_H)
x0 = 330   # left edge of the crop in the photo (moves the trees left or right in the header)
crop = src.crop((x0, 0, min(src.width, x0 + cw), ch))
img = crop.resize((OUT_W, OUT_H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))

# icy tint and a little more light
tint = Image.new('RGB', img.size, ICE)
img = Image.blend(img, tint, 0.22)
img = ImageEnhance.Brightness(img).enhance(1.06)
img = ImageEnhance.Contrast(img).enhance(0.96)

# readable left side
left = Image.new('L', img.size, 0)
ld = ImageDraw.Draw(left)
for x in range(OUT_W):
    t = x / (OUT_W * 0.50)
    a = 0.0 if t >= 1 else (1 - t) ** 1.3 * 0.88
    ld.line([(x, 0), (x, OUT_H)], fill=int(255 * a))
img = Image.composite(Image.new('RGB', img.size, (246, 250, 253)), img, left)

# fade into the page colour at the bottom
bot = Image.new('L', img.size, 0)
bd = ImageDraw.Draw(bot)
start = int(OUT_H * 0.78)
for y in range(start, OUT_H):
    bd.line([(0, y), (OUT_W, y)], fill=int(255 * min(1.0, ((y - start) / (OUT_H - start)) ** 1.1)))
img = Image.composite(Image.new('RGB', img.size, PAGE), img, bot)

path = os.path.join(root, 'assets/images/snow-storm-header.jpg')
img.save(path, 'JPEG', quality=88, optimize=True, progressive=True)
print('wrote', os.path.normpath(path), os.path.getsize(path) // 1024, 'KB', img.size)
