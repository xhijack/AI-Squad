#!/usr/bin/env python3
# Rocketbox avatar textures (2048 TGA) -> 1k web textures for glTF (dev tool, needs Pillow):
#   colour -> sRGB JPEG, normal -> JPEG, specular -> metal/rough (G = roughness, B = metalness 0) JPEG,
#   opacity (hair, lashes: RGBA) -> PNG with alpha at half size (it is the largest file).
#   python3 scripts/rocketbox-textures.py <src dir> <out dir> <prefix e.g. m005> [size]
import sys, os
from PIL import Image, ImageOps

src, out, prefix = sys.argv[1:4]
size = int(sys.argv[4]) if len(sys.argv) > 4 else 1024
os.makedirs(out, exist_ok=True)
for part in ('body', 'head'):
    for kind in ('color', 'normal'):
        im = Image.open(os.path.join(src, f'{prefix}_{part}_{kind}.tga')).convert('RGB').resize((size, size), Image.LANCZOS)
        im.save(os.path.join(out, f'{prefix}_{part}_{kind}.jpg'), quality=86, optimize=True)
    # specular (grey, 0..~170) -> roughness: shiny skin parts (lips, eyes) low, cloth high
    spec = ImageOps.grayscale(Image.open(os.path.join(src, f'{prefix}_{part}_specular.tga'))).resize((size, size), Image.LANCZOS)
    rough = spec.point(lambda v: max(60, min(245, int(245 - v * 1.25))))
    black = Image.new('L', (size, size), 0)
    Image.merge('RGB', (Image.new('L', (size, size), 255), rough, black)).save(os.path.join(out, f'{prefix}_{part}_mr.jpg'), quality=88, optimize=True)
opf = os.path.join(src, f'{prefix}_opacity_color.tga')        # hair cards and lashes; some avatars have none
if os.path.exists(opf):
  op = Image.open(opf).convert('RGBA')
  op.resize((min(size // 2, op.width), min(size // 2, op.height)), Image.LANCZOS).save(os.path.join(out, f'{prefix}_opacity.png'), optimize=True)
for f in sorted(os.listdir(out)):
    print(f, os.path.getsize(os.path.join(out, f)) // 1024, 'KB')
