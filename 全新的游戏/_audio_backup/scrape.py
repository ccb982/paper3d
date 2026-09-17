# -*- coding: utf-8 -*-
"""从 Mixkit tag 页抓取 (id, 名称)，用于定位直链。"""
import re, sys, urllib.request, json

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'}


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=40).read().decode('utf-8', 'replace')


def scrape(tag):
    html = fetch(f'https://mixkit.co/free-sound-effects/{tag}/')
    # 找形如 assets.mixkit.co/active_storage/sfx/<id>/<slug>-<id>-preview.mp3
    ids = {}
    for m in re.finditer(r'assets\.mixkit\.co[^\s"\'<>\\)]*?/sfx/(\d+)/([A-Za-z0-9\-]+)', html):
        sid, slug = m.group(1), m.group(2)
        ids.setdefault(sid, slug)
    # 也找 data 属性里的 id + name
    out = []
    for m in re.finditer(r'(?:data-audio|data-sound|data-title|title|alt)\s*=\s*"([^"]{3,80})"', html):
        pass
    print(f'--- tag={tag}: {len(ids)} ids')
    for sid, slug in ids.items():
        print(f'  {sid}  {slug}')
    return ids


for t in sys.argv[1:]:
    try:
        scrape(t)
    except Exception as e:
        print('ERR', t, e)
