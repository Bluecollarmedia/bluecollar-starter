# Prepares the header picture for the Snow Mode "More" screen from the design reference (assets/source/snow-more-header-reference.png):
#   assets/images/snow-mode-more-header.png
# The reference is a whole phone screenshot. Only the header region is kept: the green leaf, the blue "Snow Mode" wordmark, the big
# "More" title and the snowy evergreens. The phone's own clock/battery strip at the very top is painted over with the pale sky (the real
# status bar draws on top of the picture in the app), and the bottom edge fades into the page colour so there is no seam.
# Run:  python scripts/make-snow-more-header.py      (needs Pillow)
import os
from PIL import Image, ImageDraw, ImageFilter

root = os.path.join(os.path.dirname(__file__), '..')
src = Image.open(os.path.join(root, 'assets/source/snow-more-header-reference.png')).convert('RGB')
W = src.width
BOTTOM = 500          # last row of the reference to keep (just under the snow slope)
CLEAN_FROM = 86       # rows above this contain the phone's own status bar; they are repainted from the sky just below
PAGE = (241, 245, 249)  # the Snow theme's page background (#F1F5F9)

img = src.crop((0, 0, W, BOTTOM)).copy()

# 1) repaint the status-bar strip: stretch a thin clean row band upward (the sky there is a smooth gradient)
band = img.crop((0, CLEAN_FROM + 2, W, CLEAN_FROM + 6)).resize((W, CLEAN_FROM + 2), Image.BILINEAR)
band = band.filter(ImageFilter.GaussianBlur(3))
img.paste(band, (0, 0))
# a soft blend so the repaint has no hard line
blend = Image.new('L', (W, 36), 0)
bd = ImageDraw.Draw(blend)
for y in range(36):
    bd.line([(0, y), (W, y)], fill=int(255 * (1 - y / 36)))
seam = img.crop((0, CLEAN_FROM - 6, W, CLEAN_FROM + 30))
img.paste(Image.composite(band.resize((W, 36)), seam, blend), (0, CLEAN_FROM - 6)) if False else None

# 2) fade the bottom into the page colour
fade = Image.new('L', img.size, 0)
fd = ImageDraw.Draw(fade)
start = BOTTOM - 90
for y in range(start, BOTTOM):
    fd.line([(0, y), (W, y)], fill=int(255 * ((y - start) / (BOTTOM - start)) ** 1.2))
img = Image.composite(Image.new('RGB', img.size, PAGE), img, fade)

path = os.path.join(root, 'assets/images/snow-mode-more-header.png')
img.save(path, 'PNG', optimize=True)
print('wrote', os.path.normpath(path), img.size, os.path.getsize(path) // 1024, 'KB')
