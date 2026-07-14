#!/usr/bin/env python3
"""
build_stats.py — FUENTE ÚNICA → estampa las cifras de la Radiografía en las landings.

Lee stats.json (la única fuente de verdad) y estampa las cifras en el HTML crudo de:
  - radiografia.wearedomma.com   (radiografia-web/site/index.html)
  - landing AEEM                 (DOMMA-PRO-LANDING/aeem-deploy/index.html)

Las cifras quedan en el HTML (NO en JavaScript) → SEO/GEO intacto.
Idempotente: los regex están anclados en texto estable y capturan la POSICIÓN del
número, así que da igual el valor viejo. Editas stats.json y vuelves a correr.

Uso:
    python3 build_stats.py            # estampa (con backup .bak)
    python3 build_stats.py --check    # solo reporta, no escribe
"""
import json, re, sys, shutil
from pathlib import Path

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent
STATS = BASE / "stats.json"
RADIOGRAFIA = ROOT / "radiografia-web" / "site" / "index.html"
AEEM = ROOT / "DOMMA-PRO-LANDING" / "aeem-deploy" / "index.html"

# orden de las 6 barras de síntoma en el gráfico (arriba→abajo)
BAR_ORDER = ["fatiga", "peso", "insomnio", "libido", "hinchazon", "sofoco"]
# etiqueta canónica de cada síntoma (para anclar JSON-LD y lista)
LABELS = {
    "fatiga": "Fatiga", "peso": "Aumento de peso", "insomnio": "Insomnio",
    "libido": "Baja libido", "hinchazon": "Hinchazón", "sofoco": "Sofoco",
}


def stamp_radiografia(html, S):
    n = S["n_total_label"]
    sofoco = S["sofoco_pct"]
    top3 = S["top3_pct"]
    log = []

    def sub(pattern, repl, label, flags=0):
        nonlocal html
        html, c = re.subn(pattern, repl, html, flags=flags)
        log.append(f"    {label}: {c}")

    # --- N total (título, meta, hero, metodología, JSON-LD desc) ---
    sub(r'(Estudio DOMMA \()[\d.]+( mujeres\))', rf'\g<1>{n}\g<2>', "title (N)")
    sub(r'(a partir de )[\d.]+( mujeres)', rf'\g<1>{n}\g<2>', "N ·mujeres")
    sub(r'(a partir de )[\d.]+( cuestionarios)', rf'\g<1>{n}\g<2>', "N ·cuestionarios")
    sub(r'([>·"]\s*)[\d.]+( cuestionarios autorreportados)', rf'\g<1>{n}\g<2>', "N metodología")

    # --- contador animado hero (data-count="100" data-suffix="K") ---
    kval = round(S["n_total"] / 1000)
    sub(r'(data-count=")\d+("\s+data-suffix="K"[^>]*>)\d+(K)', rf'\g<1>{kval}\g<2>{kval}\g<3>', "hero counter (K)")

    # --- prosa de prevalencia ---
    sub(r'(empatan al )\d+(%)', rf'\g<1>{top3}\g<2>', "prosa ·empatan")
    sub(r'(un )\d+(% de prevalencia)', rf'\g<1>{top3}\g<2>', "prosa ·un X%")
    sub(r'(sofoco \()\d+(%\))', rf'\g<1>{sofoco}\g<2>', "prosa ·sofoco(X%)")
    sub(r'(sofoco, que aparece en el <strong>)\d+(%</strong>)', rf'\g<1>{sofoco}\g<2>', "prosa ·aparece X%")

    # --- pie del gráfico ---
    sub(r'Prevalencia autorreportada · % sobre[^<]*', S["pie_prevalencia"], "pie gráfico")

    # --- 6 síntomas: JSON-LD (anclado por nombre) ---
    for key in BAR_ORDER:
        lab = re.escape(LABELS[key]); pct = S["sintomas"][key]["pct"]
        sub(rf'("name":"{lab}","value":")\d+(%")', rf'\g<1>{pct}\g<2>', f"JSON-LD {key}")

    # --- 6 síntomas: lista <span>Label</span><span>NN%</span> (anclado por nombre) ---
    for key in BAR_ORDER:
        lab = re.escape(LABELS[key]); pct = S["sintomas"][key]["pct"]
        sub(rf'(>{lab}</span><span[^>]*>)\d+(%</span>)', rf'\g<1>{pct}\g<2>', f"lista {key}")

    # --- 6 síntomas: barras data-count (posicional, filtradas por min-width:64px) ---
    bar_re = re.compile(r'(data-count=")\d+("\s+data-suffix="%"[^>]*min-width:64px[^>]*>)\d+(%)')
    counter = {"i": 0}
    def bar_repl(m):
        key = BAR_ORDER[counter["i"] % 6]; counter["i"] += 1
        pct = S["sintomas"][key]["pct"]
        return f'{m.group(1)}{pct}{m.group(2)}{pct}{m.group(3)}'
    html = bar_re.sub(bar_repl, html)
    log.append(f"    barras data-count: {counter['i']}")

    return html, log


def stamp_aeem(html, S):
    n = S["n_total_label"]
    log = []
    # "6 patrones clínicos basados en 90.000 mujeres"  (los 65%/55% de AEEM son CSS, no tocar)
    html, c = re.subn(r'(basados en )[\d.]+( mujeres)', rf'\g<1>{n}\g<2>', html)
    log.append(f"    N ·mujeres: {c}")
    return html, log


def process(path, fn, S, check):
    if not path.exists():
        print(f"  ⚠️  no existe: {path}"); return
    html = path.read_text(encoding="utf-8")
    new, log = fn(html, S)
    print(f"\n▸ {path.relative_to(ROOT)}")
    print("\n".join(log))
    if check:
        print("    (--check: no escrito)")
    elif new != html:
        shutil.copy(path, str(path) + ".bak")
        path.write_text(new, encoding="utf-8")
        print("    ✅ escrito (backup .bak)")
    else:
        print("    = sin cambios (ya coincide con stats.json)")


def main():
    check = "--check" in sys.argv
    S = json.loads(STATS.read_text(encoding="utf-8"))
    print(f"FUENTE: {STATS.name}  |  N={S['n_total_label']}  corte={S['fecha_corte']}")
    process(RADIOGRAFIA, stamp_radiografia, S, check)
    process(AEEM, stamp_aeem, S, check)
    print("\nHecho. Deploy: ver deploy_stats.sh")


if __name__ == "__main__":
    main()
