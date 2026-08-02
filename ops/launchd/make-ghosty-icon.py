#!/usr/bin/env python3
import os
import math
import struct
import zlib

ROOT = os.path.dirname(os.path.abspath(__file__))
PNG_PATH = os.path.join(ROOT, 'ghosty-icon-1024.png')
ICONSET_DIR = os.path.join(ROOT, 'Ghosty.iconset')
ICNS_PATH = os.path.join(ROOT, 'Ghosty.app', 'Contents', 'Resources', 'GhostyIcon.icns')

os.makedirs(ICONSET_DIR, exist_ok=True)

width = 1024
height = 1024
pixels = bytearray()
for y in range(height):
    for x in range(width):
        dx = x - width * 0.5
        dy = y - height * 0.45
        r = math.hypot(dx, dy)
        t = y / (height - 1)
        bg_r = int(43 + (139 - 43) * t)
        bg_g = int(31 + (95 - 31) * t)
        bg_b = int(86 + (255 - 86) * t)
        alpha = 255
        if r < 360:
            shape = 1.0
            if r > 320:
                shape = max(0.0, 1.0 - (r - 320) / 40.0)
            ghost_r = int(255 * shape + bg_r * (1 - shape))
            ghost_g = int(255 * shape + bg_g * (1 - shape))
            ghost_b = int(255 * shape + bg_b * (1 - shape))
            pixels.extend([ghost_r, ghost_g, ghost_b, alpha])
        else:
            pixels.extend([bg_r, bg_g, bg_b, alpha])

# ghost face
for cx, cy in [(360, 420), (660, 420)]:
    for y in range(height):
        for x in range(width):
            dx = x - cx
            dy = y - cy
            if dx*dx + dy*dy < 55*55:
                idx = (y * width + x) * 4
                pixels[idx:idx+3] = b'\x34\x3b\x65'

for y in range(height):
    for x in range(width):
        dx = x - 512
        dy = y - 620
        if dx*dx + dy*dy < 100*100 and y > 620:
            idx = (y * width + x) * 4
            pixels[idx:idx+3] = b'\x34\x3b\x65'

# write png
with open(PNG_PATH, 'wb') as f:
    f.write(b'\x89PNG\r\n\x1a\n')
    def write_chunk(chunk_type, data):
        f.write(struct.pack('>I', len(data)))
        f.write(chunk_type)
        f.write(data)
        f.write(struct.pack('>I', zlib.crc32(chunk_type + data) & 0xffffffff))
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    write_chunk(b'IHDR', ihdr)
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y*width*4:(y+1)*width*4])
    compressed = zlib.compress(bytes(raw), 9)
    write_chunk(b'IDAT', compressed)
    write_chunk(b'IEND', b'')

# generate iconset
sizes = [16, 32, 128, 256, 512, 1024]
for size in sizes:
    out_path = os.path.join(ICONSET_DIR, f'icon_{size}x{size}.png')
    os.system(f'sips -z {size} {size} "{PNG_PATH}" --out "{out_path}" >/dev/null 2>&1')
    if size < 1024:
        out_path2 = os.path.join(ICONSET_DIR, f'icon_{size}x{size}@2x.png')
        os.system(f'sips -z {size*2} {size*2} "{PNG_PATH}" --out "{out_path2}" >/dev/null 2>&1')

# convert to icns
os.makedirs(os.path.dirname(ICNS_PATH), exist_ok=True)
os.system(f'iconutil -c icns "{ICONSET_DIR}" -o "{ICNS_PATH}" >/dev/null 2>&1')
print('created', ICNS_PATH)
