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

# Orden de las 6 barras del gráfico (arriba→abajo). Es un ranking, así que va de
# mayor a menor; el estampado ancla por etiqueta, no por posición, pero el script
# avisa si estos valores dejan de ir en orden descendente.
# Reordenado el 01/10/2026: hinchazón pasó de quinta a primera con el recálculo.
BAR_ORDER = ["peso", "hinchazon", "fatiga", "insomnio", "libido", "sofoco"]
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
# El orden de este dict es el orden de los <li> en el HTML: es un ranking, así que
# va de mayor a menor y el script avisa si deja de estarlo.
LISTA = {
    "Aumento de peso": "peso",
    "Hinchazón": "hinchazon",
    "Fatiga": "fatiga",
    "Baja libido": "libido",
    "Ánimo bajo": "emocional",        # en stats.json: "Inestabilidad emocional"
    "Dolor articular": "articular",
    "Sequedad": "sequedad",           # en stats.json: "Sequedad vaginal"
}


def stamp_radiografia(html, S):
    n = S["n_total_label"]
    sofoco = S["sofoco_pct"]
    # `top_pct` = el empate del primer puesto (peso e hinchazón, 65%).
    # `segundo_pct` = el segundo escalón (fatiga e insomnio, 64%).
    # Se llamaba `top3_pct` cuando la tesis era «fatiga, peso e insomnio empatan
    # al 65%». El recálculo del 01/10/2026 rompió ese empate (64/65/64) y subió
    # hinchazón al primer puesto, así que el titular pasó a ser de dos + dos.
    top = S["top_pct"]
    segundo = S["segundo_pct"]
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

    # --- prosa de prevalencia · primer puesto (empate peso + hinchazón) ---
    sub(r'(empatan al )\d+(%)', rf'\g<1>{top}\g<2>', "prosa ·empatan")
    sub(r'(un )\d+(% de prevalencia)', rf'\g<1>{top}\g<2>', "prosa ·un X%")
    sub(r'(un <strong>)\d+(%</strong> de prevalencia)', rf'\g<1>{top}\g<2>', "prosa ·un X% (strong)")
    # --- prosa de prevalencia · segundo escalón (fatiga + insomnio) ---
    sub(r'(e insomnio al )\d+(%)', rf'\g<1>{segundo}\g<2>', "prosa ·segundo (meta)")
    sub(r'(el insomnio con un )\d+(%)', rf'\g<1>{segundo}\g<2>', "prosa ·segundo (FAQ)")
    sub(r'(el insomnio\s+con un <strong>)\d+(%</strong>)', rf'\g<1>{segundo}\g<2>', "prosa ·segundo (strong)")
    # --- prosa de prevalencia · sofoco ---
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

    # --- 6 barras del gráfico: ancla por ETIQUETA, no por posición ---
    # Antes era posicional (el enésimo data-count ← BAR_ORDER[n]), lo que obligaba
    # a que el orden del HTML y de BAR_ORDER coincidieran para siempre: reordenar
    # el ranking en el HTML habría estampado el % de un síntoma sobre otro, sin
    # avisar. Ahora cada barra se localiza por su etiqueta.
    # El anclaje `font-weight:600">Etiqueta</span>` es el de la barra; la lista usa
    # `<span>Etiqueta</span>` a secas, así que no se confunden.
    # Se estampan LOS DOS números de la barra: `data-bar` es el ANCHO visual y
    # `data-count` el número que se lee. Antes sólo se tocaba el segundo, así que
    # un cambio de cifra dejaba la barra con el largo de la cifra vieja.
    for key in BAR_ORDER:
        lab = re.escape(LABELS[key]); pct = S["sintomas"][key]["pct"]
        # font-weight 600 en las 5 normales y 700 en Sofoco, que va resaltada.
        sub(rf'(font-weight:[67]00[^>]*">{lab}</span>.*?data-bar=")\d+(".*?data-count=")\d+("[^>]*>)\d+(%)',
            rf'\g<1>{pct}\g<2>{pct}\g<3>{pct}\g<4>', f"barra {key}", flags=re.S)

    # El gráfico y la lista son RANKINGS. El estampado sólo cambia números, no
    # reordena bloques, así que si un recálculo cambia los puestos hay que
    # reordenar el HTML a mano. Sin este aviso quedaría una lista desordenada con
    # pinta de ranking, que es peor que una cifra vieja. Pasó el 01/10/2026:
    # hinchazón subió de quinta a primera y las dos listas quedaron descolocadas.
    def avisa_orden(claves, que, donde):
        pcts = [S["sintomas"][k]["pct"] for k in claves]
        if pcts != sorted(pcts, reverse=True):
            fallos.append(
                f"{que} no está en orden descendente: "
                + " · ".join(f"{S['sintomas'][k]['label']} {S['sintomas'][k]['pct']}%" for k in claves)
                + f" → reordena {donde}")

    avisa_orden(BAR_ORDER, "el gráfico de barras", "los bloques del gráfico y BAR_ORDER")
    avisa_orden(list(LISTA.values()), "la lista «Lo silencioso»", "los <li> y LISTA")

    return html, log, fallos


def stamp_aeem(html, S):
    # La landing de AEEM NO tiene prevalencias: todos sus % son CSS (anchos,
    # gradientes, border-radius) — auditado el 02/10/2026, no tocar.
    # Lo que sí tiene son DOS cifras de N, y hasta hoy sólo se estampaba una:
    # decía «basados en 100.000 mujeres» y, tres líneas más abajo, «90K mujeres
    # en el estudio». Las dos van ahora en CUESTIONARIOS, porque los tests
    # (104.140) y las mujeres (98.842) no son lo mismo: parte de la muestra
    # repitió el cuestionario, así que «104.000 mujeres» sería falso.
    tests = S["n_tests_label"]
    log, fallos = [], []

    def sub(pattern, repl, label):
        nonlocal html
        html, c = re.subn(pattern, repl, html)
        log.append(f"    {label}: {c}")
        if c == 0:
            fallos.append(f"AEEM · {label}")

    sub(r'(basados en )[\d.]+( cuestionarios)', rf'\g<1>{tests}\g<2>', "N ·cuestionarios")
    # Tarjeta del hero: «104K cuestionarios del estudio»
    kval = round(S["n_tests"] / 1000)
    sub(r'(class="hp-n">)\d+K(</span><span class="hp-l">cuestionarios)',
        rf'\g<1>{kval}K\g<2>', "N ·hero (K)")
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
