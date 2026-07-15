#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_index.py — 디자인팀 폴더의 파일 인덱스를 생성합니다.
사용법:
    python tools/build_index.py "D:/디자인팀"
    python tools/build_index.py "/Volumes/NAS/design" --out data/fileindex.json

생성된 data/fileindex.json 을 저장소에 커밋하면
Refilled Design Hub의 '파일 파인더'에서 팀 전체가 검색할 수 있어요.
"""
import os, sys, json, argparse

SKIP_DIRS = {'.git', 'node_modules', '$RECYCLE.BIN', 'System Volume Information', '.Trash', '__MACOSX'}
SKIP_FILES = {'.DS_Store', 'Thumbs.db', 'desktop.ini'}

def build(root, max_files=50000):
    root = os.path.abspath(root)
    items = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith('.')]
        for fn in filenames:
            if fn in SKIP_FILES or fn.startswith('~$'):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root).replace('\\', '/')
            try:
                st = os.stat(full)
            except OSError:
                continue
            items.append({
                'path': rel,
                'name': fn,
                'ext': os.path.splitext(fn)[1].lower().lstrip('.'),
                'size': st.st_size,
                'mtime': int(st.st_mtime),
            })
            if len(items) >= max_files:
                print(f'⚠ {max_files}개 제한에 도달해 중단했어요. 하위 폴더별로 나눠 실행해보세요.')
                return items
    return items

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('root', help='인덱싱할 최상위 폴더 (예: D:/디자인팀)')
    ap.add_argument('--out', default='data/fileindex.json')
    args = ap.parse_args()

    items = build(args.root)
    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(items, f, ensure_ascii=False, separators=(',', ':'))
    print(f'✓ {len(items):,}개 파일 인덱싱 완료 → {args.out}')
    print('이 파일을 저장소 data/ 폴더에 커밋하면 파일 파인더에서 검색할 수 있어요.')
