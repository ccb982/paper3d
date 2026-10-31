# -*- coding: utf-8 -*-
"""抓 Mixkit tag 页，输出 (id, 名称, 时长) 三元组。"""
import re, sys, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'}


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read().decode('utf-8', 'replace')


for tag in sys.argv[1:]:
    html = fetch(f'https://mixkit.co/free-sound-effects/{tag}/')
    # item 块：data-audio-name / item-grid-audio-player ... 用宽松方式：
    # 找到每个 waveform 图片/链接附近的 title 与该块里的 sfx id
    blocks = re.split(r'(?=<li |<div class="item)', html)
    print(f'===== {tag} =====')
    seen = set()
    for m in re.finditer(
        r'(?:data-name|data-title|alt|title)="([^"]{3,70})"[\s\S]{0,3000}?/sfx/(\d+)/',
        html):
        name, sid = m.group(1), m.group(2)
        if (name, sid) in seen:
            continue
        seen.add((name, sid))
        print(f'  {sid:>5}  {name}')
    # 兜底：只列出 id
    ids = re.findall(r'/sfx/(\d+)/', html)
    print(f'  --- all ids({len(set(ids))}): {" ".join(sorted(set(ids), key=int))}')
