"""
Measures the compression rules from src/lib/mediaPlan.ts on this computer (PROXY MEASUREMENT, not the phone).

Photos: Pillow's libjpeg at the same settings the app uses (long side <= 1600 px, JPEG quality 50).
Videos: ffmpeg/libx264 at the same target (<= 854x480, ratio kept, even sizes, bitrate from planVideo, AAC audio kept).
The phone's own encoders (iOS/Android) will give somewhat different sizes; the real-device numbers are still to be measured.
Test content is synthetic (no real camera files were used), so the savings are indicative only.

Usage: python scripts/measure_compression.py <output-folder>
"""
import os, sys, subprocess, json, math, shutil
import numpy as np
from PIL import Image

out = sys.argv[1] if len(sys.argv) > 1 else 'measure-out'
os.makedirs(out, exist_ok=True)
FF = shutil.which('ffmpeg') or 'ffmpeg'
FP = shutil.which('ffprobe') or 'ffprobe'

def kb(n): return f'{n/1024:.0f} KB' if n < 1024*1024 else f'{n/1024/1024:.2f} MB'

def photo_like(w, h, seed):
    """Natural-ish test image: smooth colour regions + mid/fine texture + a few hard edges + sensor-like noise."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    base = np.stack([np.sin(xx/w*3.1+seed)*60+120, np.cos(yy/h*2.4)*50+110, np.sin((xx+yy)/(w+h)*4)*40+100], -1)
    def octave(scale, amp):
        small = rng.normal(0, 1, (max(2, h//scale), max(2, w//scale), 3)).astype(np.float32)
        return np.asarray(Image.fromarray(((small*40)+128).clip(0, 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), dtype=np.float32).__sub__(128)*amp/40
    img = base + octave(256, 1.0) + octave(48, 0.9) + octave(8, 0.9) + octave(3, 1.4)   # fine grass/foliage-like texture
    img[(xx > w*0.55) & (yy < h*0.4)] += 35            # a hard-edged region (building / sky line)
    img += rng.normal(0, 9.0, img.shape)                # sensor noise
    return Image.fromarray(img.clip(0, 255).astype(np.uint8))

def psnr(a, b):
    a = np.asarray(a, dtype=np.float32); b = np.asarray(b, dtype=np.float32)
    mse = float(np.mean((a-b)**2)); return 99.0 if mse == 0 else 10*math.log10(255*255/mse)

print('PHOTOS (original: JPEG quality 92 like a phone camera; compressed: long side <= 1600, JPEG quality 50)')
rows = []
for name, (w, h) in {'landscape 4032x3024': (4032, 3024), 'portrait 3024x4032': (3024, 4032), 'small 1280x960': (1280, 960)}.items():
    im = photo_like(w, h, seed=len(name))
    orig = os.path.join(out, f'photo_{w}x{h}_orig.jpg'); im.save(orig, quality=92)
    long = max(w, h); scale = min(1.0, 1600/long)
    nw, nh = round(w*scale), round(h*scale)
    small = im.resize((nw, nh), Image.LANCZOS) if scale < 1 else im
    comp = os.path.join(out, f'photo_{w}x{h}_q50.jpg'); small.save(comp, quality=50)
    o, c = os.path.getsize(orig), os.path.getsize(comp)
    ref = im.resize((nw, nh), Image.LANCZOS) if scale < 1 else im
    q = psnr(ref, Image.open(comp).convert('RGB'))
    ratio_ok = abs((nw/nh) - (w/h)) < 0.002
    print(f'  {name}: {kb(o)} -> {kb(c)} ({100*(1-c/o):.0f}% smaller), output {nw}x{nh}, ratio kept: {ratio_ok}, PSNR vs resized original {q:.1f} dB')
    rows.append((name, o, c))

print('\nVIDEOS (original: H.264 ~8 Mbps 1080p 30 fps + AAC audio like a phone; compressed: <= 854x480, ratio kept)')
def make_video(path, w, h, secs=6, rotate_tag=False):
    subprocess.run([FF, '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', f'testsrc2=size={w}x{h}:rate=30:duration={secs}',
                    '-f', 'lavfi', '-i', f'sine=frequency=440:duration={secs}', '-c:v', 'libx264', '-b:v', '8M', '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', '-b:a', '128k', '-shortest', path], check=True)

def probe(path):
    j = json.loads(subprocess.run([FP, '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path], capture_output=True, text=True).stdout)
    v = next(s for s in j['streams'] if s['codec_type'] == 'video')
    a = next((s for s in j['streams'] if s['codec_type'] == 'audio'), None)
    return v, a, j['format']

def plan(w, h):
    long, short = max(w, h), min(w, h)
    s = min(1.0, 854/long, 480/short)
    nw, nh = (w, h) if s >= 1 else (math.floor(w*s + 0.5), math.floor(h*s + 0.5))
    ev = lambda n: max(2, math.floor(n/2 + 0.5)*2)   # same rounding as JavaScript's Math.round, as in mediaPlan.ts
    nw, nh = ev(nw), ev(nh)
    return nw, nh, int(min(1_500_000, max(600_000, nw*nh*2.7)))

for name, (w, h) in {'landscape 1920x1080': (1920, 1080), 'portrait 1080x1920': (1080, 1920), '4:3 1440x1080': (1440, 1080), 'already small 640x360': (640, 360)}.items():
    src = os.path.join(out, f'video_{w}x{h}_orig.mp4'); make_video(src, w, h)
    nw, nh, br = plan(w, h)
    dst = os.path.join(out, f'video_{w}x{h}_480p.mp4')
    subprocess.run([FF, '-y', '-loglevel', 'error', '-i', src, '-vf', f'scale={nw}:{nh}', '-c:v', 'libx264', '-b:v', str(br), '-maxrate', str(int(br*1.3)), '-bufsize', str(br*2),
                    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', dst], check=True)
    v, a, f = probe(dst)
    o, c = os.path.getsize(src), os.path.getsize(dst)
    same_ratio = abs(int(v['width'])/int(v['height']) - w/h) < 0.01
    print(f"  {name}: {kb(o)} -> {kb(c)} ({100*(1-c/o):.0f}% smaller), output {v['width']}x{v['height']} {v['codec_name']}, "
          f"audio {'kept (' + a['codec_name'] + ')' if a else 'MISSING'}, ratio kept: {same_ratio}, duration {float(f['duration']):.1f}s, capped at 480p: {max(int(v['width']), int(v['height'])) <= 854 and min(int(v['width']), int(v['height'])) <= 480}")
print('\nDone. Files are in', out)
