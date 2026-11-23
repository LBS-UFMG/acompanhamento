#!/usr/bin/env python3
"""Gera dist/: o site para publicar como página no claude.ai.

dist/acompanhamento-lbs.html embute styles.css, dados-lbs.enc.js (dados cifrados), app.js e os logos (como data URI).
As fotos dos alunos (cópias reduzidas em assets/fotos/) vão para dist/fotos/ e são publicadas ao
lado da página; window.LBS_FOTOS troca cada URL do site do LBS pela cópia local. O HTML não tem
<!doctype>/<html>/<head>/<body> porque o publicador do claude.ai adiciona esse esqueleto.

Uso:  python3 publicar.py
"""
import base64
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / 'dist' / 'acompanhamento-lbs.html'


def read(name):
    return (ROOT / name).read_text(encoding='utf-8')


def data_uri(path):
    data = base64.b64encode((ROOT / path).read_bytes()).decode('ascii')
    return f'data:image/svg+xml;base64,{data}'


def inline_script(code):
    if '</script' in code.lower():
        raise SystemExit('Script contém "</script" e quebraria a página.')
    return f'<script>\n{code}\n</script>'


def main():
    html = read('index.html')
    body = re.search(r'<body>(.*)</body>', html, re.S).group(1)

    # Scripts externos -> embutidos
    # Fotos: URL original do site do LBS -> cópia local publicada em fotos/
    fotos_dir = OUT.parent / 'fotos'
    fotos_dir.mkdir(parents=True, exist_ok=True)
    fotos = {}
    for foto in sorted((ROOT / 'assets' / 'fotos').glob('*.jpg')):
        (fotos_dir / foto.name).write_bytes(foto.read_bytes())
        for ext in ('jpg', 'png'):
            fotos[f'https://bioinfo.dcc.ufmg.br/uploads/{foto.stem}.{ext}'] = f'fotos/{foto.name}'
        fotos[f'assets/fotos/{foto.name}'] = f'fotos/{foto.name}'  # fotos locais (enviadas à mão)
    body = re.sub(r'(\s*<script src="dados-lbs\.enc\.js)',
                  lambda m: '\n' + inline_script('window.LBS_FOTOS = ' + json.dumps(fotos, indent=1) + ';') + m.group(1),
                  body, count=1)

    for name in ('dados-lbs.enc.js', 'app.js'):
        tag = inline_script(read(name))
        pattern = r'\s*<script src="' + re.escape(name) + r'[^"]*"></script>'
        body = re.sub(pattern, lambda _m, tag=tag: '\n' + tag, body)

    # Downloads não funcionam na página publicada: remove o botão "Baixar arquivo" (fica "Copiar").
    body = re.sub(r'\s*<button[^>]*id="export-download"[^>]*>.*?</button>', '', body, flags=re.S)
    body = body.replace(', ou use “Baixar arquivo”', '')

    # Logos -> data URI
    for svg in ('assets/LBS_horizontal.svg', 'assets/LBS_horizontal_branca.svg'):
        body = body.replace(f'src="{svg}"', f'src="{data_uri(svg)}"')

    if re.search(r'(src|href)="(assets/|[\w-]+\.(js|css))', body):
        raise SystemExit('Ainda há referência a arquivo local no HTML gerado.')

    page = (
        '<title>Acompanhamento LBS</title>\n'
        f'<style>\n{read("styles.css")}\n</style>\n'
        f'{body.strip()}\n'
    )
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(page, encoding='utf-8')
    print(f'Gerado {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB) + {len(list(fotos_dir.glob("*.jpg")))} fotos em dist/fotos/')


if __name__ == '__main__':
    main()
