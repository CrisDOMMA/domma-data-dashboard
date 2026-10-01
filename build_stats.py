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
# etiqueta canónica de cada síntoma (para anclar JSON-LD y barras)
LABELS = {
    "fatiga": "Fatiga", "peso": "Aumento de peso", "insomnio": "Insomnio",
    "libido": "Baja libido", "hinchazon": "Hinchazón", "sofoco": "Sofoco",
}

# La LISTA de la página es OTRA cosa que las barras: tiene 7 entradas, con
# etiquetas propias que no coinciden con las de LABELS, y no incluye Insomnio ni
# Sofoco. Hasta el 01/10/2026 se intentaba estampar con LABELS/BAR_ORDER, así que
# `Insomnio` y `Sofoco` daban 0 coincidencias (silenciosamente) y `Sequedad` y
# `Dolor articular` NO SE TOCABAN NUNCA: llevaban 46% y 43% en vivo cuando
# stats.json decía 49 y 46. Esta tabla mapea la etiqueta tal como está en el HTML
# a su clave en stats.json.
LISTA = {
    "Fatiga": "fatiga",
    "Aumento de peso": "peso",
    "Baja libido": "libido",
    "Hinchazón": "hinchazon",
    "Ánimo bajo": "emocional",        # en stats.json: "Inestabilidad emocional"
    "Sequedad": "sequedad",           # en stats.json: "Sequedad vaginal"
    "Dolor articular": "articular",
}


def stamp_radiografia(html, S):
    n = S["n_total_label"]
    sofoco = S["sofoco_pct"]
    top3 = S["top3_pct"]
    log = []
    fallos = []   # anclajes con 0 coincidencias: el script ya NO los deja pasar

    def sub(pattern, repl, label, flags=0):
        nonlocal html
        html, c = re.subn(pattern, repl, html, flags=flags)
        log.append(f"    {label}: {c}")
        if c == 0:
            fallos.append(label)

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

    # --- lista de 7 síntomas: <span>Etiqueta</span><span>NN%</span> ---
    for lab_html, key in LISTA.items():
        lab = re.escape(lab_html); pct = S["sintomas"][key]["pct"]
        sub(rf'(>{lab}</span><span[^>]*>)\d+(%</span>)', rf'\g<1>{pct}\g<2>', f"lista {lab_html}")

    # --- 6 síntomas: barras data-count (posicional, filtradas por min-width:64px) ---
    bar_re = re.compile(r'(data-count=")\d+("\s+data-suffix="%"[^>]*min-width:64px[^>]*>)\d+(%)')
    counter = {"i": 0}
    def bar_repl(m):
        key = BAR_ORDER[counter["i"] % 6]; counter["i"] += 1
        pct = S["sintomas"][key]["pct"]
        return f'{m.group(1)}{pct}{m.group(2)}{pct}{m.group(3)}'
    html = bar_re.sub(bar_repl, html)
    log.append(f"    barras data-count: {counter['i']}")
    # Las barras son POSICIONALES: si no son exactamente 6, el mapeo con
    # BAR_ORDER se desplaza y estampa el % de un síntoma sobre otro.
    if counter["i"] != len(BAR_ORDER):
        fallos.append(f"barras data-count: {counter['i']} (se esperaban {len(BAR_ORDER)})")

    return html, log, fallos


def stamp_aeem(html, S):
    n = S["n_total_label"]
    log = []
    fallos = []
    # "6 patrones clínicos basados en 90.000 mujeres"  (los 65%/55% de AEEM son CSS, no tocar)
    html, c = re.subn(r'(basados en )[\d.]+( mujeres)', rf'\g<1>{n}\g<2>', html)
    log.append(f"    N ·mujeres: {c}")
    if c == 0:
        fallos.append("N ·mujeres")
    return html, log, fallos


def process(path, fn, S, check):
    """Devuelve la lista de anclajes que no casaron (vacía = todo bien)."""
    if not path.exists():
        print(f"  ⚠️  no existe: {path}")
        return [f"fichero ausente: {path}"]
    html = path.read_text(encoding="utf-8")
    new, log, fallos = fn(html, S)
    print(f"\n▸ {path.relative_to(ROOT)}")
    print("\n".join(log))
    if fallos:
        # No se escribe un fichero a medias: o casan todos los anclajes o ninguno.
        print(f"    ❌ {len(fallos)} anclaje(s) sin coincidencia — NO se escribe")
        return fallos
    if check:
        print("    (--check: no escrito)")
    elif new != html:
        shutil.copy(path, str(path) + ".bak")
        path.write_text(new, encoding="utf-8")
        print("    ✅ escrito (backup .bak)")
    else:
        print("    = sin cambios (ya coincide con stats.json)")
    return []


def main():
    check = "--check" in sys.argv
    S = json.loads(STATS.read_text(encoding="utf-8"))
    print(f"FUENTE: {STATS.name}  |  N={S['n_total_label']}  corte={S['fecha_corte']}")
    fallos = process(RADIOGRAFIA, stamp_radiografia, S, check)
    fallos += process(AEEM, stamp_aeem, S, check)

    # Antes del 01/10/2026 esto sólo imprimía ": 0" y seguía como si nada, así que
    # `Sequedad` y `Dolor articular` llevaban meses desfasados en la web sin que
    # nadie se enterara. Un anclaje que no casa es el HTML cambiando debajo: hay
    # que mirarlo, no publicar a medias.
    if fallos:
        print("\n❌ ANCLAJES QUE NO CASAN — el HTML ha cambiado debajo del script:")
        for f in fallos:
            print(f"     · {f}")
        print("   Revisa el HTML y actualiza LISTA/LABELS/BAR_ORDER antes de publicar.")
        sys.exit(1)

    print("\nHecho. Deploy: ver deploy_stats.sh")


if __name__ == "__main__":
    main()
