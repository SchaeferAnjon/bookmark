#!/usr/bin/env python3
"""生成 Mac App 图标（mac/App/Assets.xcassets/AppIcon.appiconset），图案与扩展图标相同。
macOS 图标的圆角方块四周留约 10% 透明边距，和系统其他 App 大小一致。纯标准库。"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from make_icons import make_icon, write_png  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', 'mac', 'App', 'Assets.xcassets', 'AppIcon.appiconset')
SIZES = [16, 32, 128, 256, 512]


def padded(size):
    inner = round(size * 0.80)
    pad_top = (size - inner) // 2
    _, _, rows = make_icon(inner)
    blank = b'\x00' * (size * 4)
    left = b'\x00' * (pad_top * 4)
    right = b'\x00' * ((size - inner - pad_top) * 4)
    out = [blank] * pad_top + [left + r + right for r in rows]
    out += [blank] * (size - len(out))
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    images = []
    for base in SIZES:
        for scale in (1, 2):
            px = base * scale
            name = f'icon_{base}x{base}{"@2x" if scale == 2 else ""}.png'
            write_png(os.path.join(OUT, name), px, px, padded(px))
            images.append({'idiom': 'mac', 'size': f'{base}x{base}', 'scale': f'{scale}x', 'filename': name})
    with open(os.path.join(OUT, 'Contents.json'), 'w') as f:
        json.dump({'images': images, 'info': {'author': 'xcode', 'version': 1}}, f, indent=2)
    with open(os.path.join(OUT, '..', 'Contents.json'), 'w') as f:
        json.dump({'info': {'author': 'xcode', 'version': 1}}, f, indent=2)
    print('wrote', os.path.normpath(OUT))


if __name__ == '__main__':
    main()
