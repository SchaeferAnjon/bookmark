#!/usr/bin/env python3
"""生成扩展图标：圆角蓝底 + 白色书签丝带，纯标准库输出 PNG。"""
import struct
import zlib
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")


def write_png(path, w, h, rows):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    raw = b"".join(b"\x00" + row for row in rows)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def make_icon(size):
    w = h = size
    r = 0.22 * w  # 圆角半径
    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            # 圆角矩形背景（超采样 2x2 抗锯齿）
            cover = 0
            for sx in (0.25, 0.75):
                for sy in (0.25, 0.75):
                    px, py = x + sx, y + sy
                    dx = max(r - px, px - (w - r), 0)
                    dy = max(r - py, py - (h - r), 0)
                    if dx * dx + dy * dy <= r * r:
                        cover += 1
            if cover == 0:
                row += b"\x00\x00\x00\x00"
                continue
            alpha = cover * 255 // 4
            # 竖向渐变：#4f6ef7 -> #7b53e8
            t = y / h
            bg = (
                int(0x4F + (0x7B - 0x4F) * t),
                int(0x6E + (0x53 - 0x6E) * t),
                int(0xF7 + (0xE8 - 0xF7) * t),
            )
            # 书签丝带：x∈[0.34,0.66]w, y∈[0.20,0.82]h，底部中间 V 形缺口
            fx, fy = (x + 0.5) / w, (y + 0.5) / h
            in_ribbon = 0.34 <= fx <= 0.66 and 0.20 <= fy <= min(0.82, 0.66 + abs(fx - 0.5))
            color = (255, 255, 255) if in_ribbon else bg
            row += bytes(color) + bytes([alpha])
        rows.append(bytes(row))
    return w, h, rows


if __name__ == "__main__":  # make_app_icon.py 会 import 这里的函数
    for size in (16, 48, 128):
        w, h, rows = make_icon(size)
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        write_png(path, w, h, rows)
        print(f"wrote {path}")
