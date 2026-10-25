import sys, os, glob
from PIL import Image, ImageChops, ImageStat

src_dir, out_path = sys.argv[1], sys.argv[2]
fps = float(sys.argv[3]) if len(sys.argv) > 3 else 12.0
width = int(sys.argv[4]) if len(sys.argv) > 4 else 1400
colors = int(sys.argv[5]) if len(sys.argv) > 5 else 160
trim_start = float(sys.argv[6]) if len(sys.argv) > 6 else 0.0

files = sorted(glob.glob(os.path.join(src_dir, '*.png')))
frames = []
for path in files:
    im = Image.open(path).convert('RGB')
    if im.width != width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    frames.append(im)

start_idx = int(trim_start * fps)
frames = frames[start_idx:]
base = frames[0].size

# Global palette sampled across the clip so colors stay stable.
step = max(1, len(frames) // 24)
samples = frames[::step][:24]
sample = Image.new('RGB', (base[0], base[1] * len(samples)))
for i, im in enumerate(samples):
    sample.paste(im, (0, i * base[1]))
palette = sample.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)

quantized = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in frames]

# Keep a frame when enough pixels actually changed (small UI deltas like a
# typed character must not be averaged away by the global mean).
MIN_CHANGED_PIXELS = 60
out_frames, durations = [], []
prev = None
for im in quantized:
    if prev is None:
        out_frames.append(im)
        durations.append(1)
    else:
        diff = ImageChops.difference(im.convert('L'), prev.convert('L'))
        changed = sum(diff.histogram()[12:])
        if changed < MIN_CHANGED_PIXELS:
            durations[-1] += 1
        else:
            out_frames.append(im)
            durations.append(1)
    prev = im

out_frames[0].save(
    out_path,
    save_all=True,
    append_images=out_frames[1:],
    duration=[max(20, round(1000 / fps * d)) for d in durations],
    loop=0,
    optimize=False,
    disposal=2,
)
print(f'{os.path.basename(out_path)}: {len(out_frames)} frames, {os.path.getsize(out_path)/1e6:.2f} MB')
