# Radiografía · Fuente única de cifras

**Problema que resuelve:** la cifra de la Radiografía (nº de mujeres + % de síntomas) estaba
hardcodeada en 5 sitios distintos → se descuadraban. Ahora hay **una sola fuente**.

## Cómo funciona

```
stats.json  ← ÚNICA FUENTE DE VERDAD (editas AQUÍ)
   │  (se sirve en https://data.wearedomma.com/stats.json)
   └─► build_stats.py  ── estampa las cifras en el HTML crudo de:
          • radiografia.wearedomma.com   (radiografia-web/site/index.html)
          • landing AEEM                 (DOMMA-PRO-LANDING/aeem-deploy/index.html)
```

Las cifras quedan **en el HTML**, no en JavaScript → Google/ChatGPT/Perplexity las leen (SEO/GEO intacto).

## Para actualizar las cifras (p. ej. cuando lleguemos a 110K o cambien los %)

1. Edita **`stats.json`** (y solo eso).
2. `python3 build_stats.py --check`   → revisa qué cambiaría (no escribe).
3. `bash deploy_stats.sh`             → estampa + despliega radiografia. (AEEM: ver abajo.)

`build_stats.py` es **idempotente**: los regex están anclados en texto estable y capturan la
posición del número, así que da igual el valor anterior. Correrlo dos veces no rompe nada.

## Qué cubre cada superficie

- **radiografia** (completo): título, meta description, JSON-LD (Dataset + Article + FAQ),
  hero, contador animado, 6 barras de síntoma (data-count + lista), prosa, pie del gráfico, metodología.
- **AEEM**: la línea "…basados en N mujeres". (Los `65%`/`55%` de esa página son *stops de gradiente CSS*, NO se tocan.)
- **Dashboard** `data.wearedomma.com`: sus gráficos van por el pipeline `actualizar_dashboard.py`
  (necesita los CSV crudos). El dashboard **aloja** stats.json; no se estampa desde build_stats.py.

## Cifras actuales (14/07/2026)

- N total registro: **100.000** (real 99.568) · muestra analizada: ~95.000 (94.651 RevenueHunt+Typeform)
- Síntomas: Fatiga 65 · Peso 65 · Insomnio 65 · Libido 63 · Hinchazón 56 · Sofoco 54
- Pie oficial: *"Prevalencia autorreportada · % sobre ~95.000 analizados · registro +100.000"*
