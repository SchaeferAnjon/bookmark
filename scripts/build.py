#!/usr/bin/env python3
"""打包扩展（纯标准库，Xcode 构建时也会调用）。

  dist/chrome/                                  Chrome 开发版（和仓库根目录一样，可「加载已解压的扩展程序」）
  dist/safari/                                  Safari 扩展资源，Xcode 把它拷进 Safari 扩展
  dist/bookmark-keeper-<版本>-chrome-web-store.zip  上传 Chrome 应用商店用（去掉 manifest 里的 key）

用法：
  python3 scripts/build.py                      全部
  python3 scripts/build.py --target safari --out <目录>   只生成 Safari 资源并拷到 <目录>（Xcode 用）
"""
import argparse
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'

COMMON = ['background.js', 'icons', 'newtab', 'popup', 'shared']
CHROME_ONLY = ['manager', 'options']  # 依赖书签接口，Safari 没有
IGNORE = shutil.ignore_patterns('.DS_Store', '*.test.js')


def load_manifest():
    return json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))


def dump(manifest):
    return json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'


def fresh_dir(path):
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)
    return path


def copy_sources(names, dest):
    for name in names:
        src = ROOT / name
        if src.is_dir():
            shutil.copytree(src, dest / name, ignore=IGNORE, dirs_exist_ok=True)
        else:
            shutil.copy2(src, dest / name)


def chrome_manifest(manifest):
    return manifest


def store_manifest(manifest):
    # 应用商店不接受 key 字段；上架后商店会分配自己的 ID（把商店后台的公钥填回 manifest.json 的
    # key，开发版和商店版的 ID 就一致了，见 docs/RELEASING.md）
    m = dict(manifest)
    m.pop('key', None)
    return m


def safari_manifest(manifest):
    m = json.loads(json.dumps(manifest))
    m['description'] = '新标签页：快捷书签分组 + 打开标签按域名整理；经 BookmarkKeeper App 用 iCloud 与 Chrome、其他 Mac 同步'
    m.pop('key', None)
    m.pop('options_page', None)       # 设置页只管 AI 整理，Safari 里没有这个功能
    m.pop('host_permissions', None)   # 失效检测 / AI 才需要；Safari 里不要，免得每个网站都弹授权
    m['permissions'] = [p for p in m['permissions'] if p not in ('bookmarks', 'favicon')]
    return m


def build_chrome(manifest):
    dest = fresh_dir(DIST / 'chrome')
    copy_sources(COMMON + CHROME_ONLY, dest)
    (dest / 'manifest.json').write_text(dump(chrome_manifest(manifest)), encoding='utf-8')
    return dest


def build_store_zip(manifest, chrome_dir):
    out = DIST / f"bookmark-keeper-{manifest['version']}-chrome-web-store.zip"
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in sorted(chrome_dir.rglob('*')):
            if f.is_file() and f.name != 'manifest.json':
                z.write(f, f.relative_to(chrome_dir).as_posix())
        z.writestr('manifest.json', dump(store_manifest(manifest)))
    return out


def build_safari(manifest, out=None):
    dest = fresh_dir(DIST / 'safari')
    copy_sources(COMMON, dest)
    (dest / 'manifest.json').write_text(dump(safari_manifest(manifest)), encoding='utf-8')
    if out:
        out = Path(out)
        out.mkdir(parents=True, exist_ok=True)
        shutil.copytree(dest, out, dirs_exist_ok=True)
    return dest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--target', choices=['all', 'chrome', 'safari'], default='all')
    ap.add_argument('--out', help='额外把产物拷到这个目录（Xcode 构建用）')
    args = ap.parse_args()

    manifest = load_manifest()
    if args.target in ('all', 'chrome'):
        chrome_dir = build_chrome(manifest)
        if args.out and args.target == 'chrome':
            shutil.copytree(chrome_dir, Path(args.out), dirs_exist_ok=True)
        print('chrome  ->', chrome_dir.relative_to(ROOT))
        print('store   ->', build_store_zip(manifest, chrome_dir).relative_to(ROOT))
    if args.target in ('all', 'safari'):
        print('safari  ->', build_safari(manifest, args.out if args.target == 'safari' else None).relative_to(ROOT))


if __name__ == '__main__':
    main()
