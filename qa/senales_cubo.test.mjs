#!/usr/bin/env node
// Red de regresión del cubo «🔔 Alerta de baja» en la estación /llamadas (23/10/2026).
//
// El cubo es la última pieza del recorte de escalados: LUNA ya no manda email por cada
// señal de baja, así que si este cubo se rompe o se vacía en silencio, esas mujeres NO
// las ve nadie. Antes había un email molesto; ahora no hay nada. Por eso hay red.
//
// Se lee el HTML REAL y se evalúan los trozos de lógica que importan, para que renombrar
// una variable ponga el test rojo en vez de dejar el cubo mudo.
//
// Uso: node qa/senales_cubo.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(AQUI, '..', 'llamadas', 'index.html'), 'utf8');

const C = { g: '\x1b[32m', r: '\x1b[31m', b: '\x1b[1m', d: '\x1b[2m', x: '\x1b[0m' };
let ok = 0, ko = 0;
function check(nombre, fn) {
  try { fn(); ok++; console.log(`  ${C.g}✅${C.x} ${nombre}`); }
  catch (e) { ko++; console.log(`  ${C.r}❌ ${nombre}${C.x}\n     ${C.r}↳ ${e.message}${C.x}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const grupo = t => console.log(`\n${C.b}${t}${C.x}`);

console.log(`\n${C.b}🔔 Cubo «Alerta de baja» — /llamadas${C.x}`);

// ── 1. El cableado: que el cubo EXISTA de punta a punta ────────────────────────────────
grupo('Cableado — que la sección siga enchufada');

check('pide las señales al backend', () => {
  assert(/\/api\/dashboard\/senales-baja/.test(HTML),
    '🚨 nadie llama al endpoint: el cubo saldría vacío y parecería que no hay casos');
});

check('la petición NO puede tumbar la estación', () => {
  const linea = HTML.split('\n').find(l => l.includes('/api/dashboard/senales-baja'));
  assert(/\.catch\(/.test(linea),
    '🚨 sin .catch, un fallo del endpoint nuevo deja a Carme sin fallos de pago ni bajas');
});

check('el chip está en la barra de filtros', () => {
  assert(/\['senal','🔔 Alerta de baja'\]/.test(HTML), 'falta el chip en `defs`');
  assert(/senal:senales\.length/.test(HTML), 'falta el contador en `counts`');
  assert(/filtro==='senal'\)\{ VIS=senales; \}/.test(HTML), 'el chip no enseña nada');
});

check('la tarjeta pinta la lectura de la conversación', () => {
  assert(/c\.lectura\?`<div class="lectura">/.test(HTML),
    '🚨 sin el resumen, Carme ve un nombre y llama a ciegas — fue el requisito de Cristina');
  assert(/\.lectura\{/.test(HTML), 'el bloque no tiene estilo y se mezcla con el resto');
});

check('el color de la lectura usa una variable que existe', () => {
  const css = (HTML.match(/\.lectura\{[^}]*\}/) || [''])[0];
  for (const v of css.match(/var\((--[a-z-]+)\)/g) || []) {
    const nombre = v.slice(4, -1);
    assert(new RegExp(`${nombre}\\s*:`).test(HTML), `\`${nombre}\` no está en la paleta → se pinta transparente`);
  }
});

// ── 2. Las etiquetas y el orden ────────────────────────────────────────────────────────
grupo('Motivos — los tres que llegan, y en qué orden');

const LBL_SENAL = eval('(' + (HTML.match(/const LBL_SENAL=(\{[\s\S]*?\});/) || [])[1] + ')');
const ORDEN_SENAL = eval((HTML.match(/const ORDEN_SENAL=(\[[^\]]*\]);/) || [])[1]);

check('los tres motivos del backend tienen etiqueta', () => {
  // Espejo de `CATEGORIAS_A_LA_ESTACION` en flujo-bajas/worker/src/index.js. Si allí se
  // añade un motivo y aquí no, la tarjeta diría «Señal de baja» a secas.
  for (const m of ['no_puede_darse_de_baja', 'efectos_secundarios', 'no_le_funciona']) {
    assert(LBL_SENAL[m], `sin etiqueta para \`${m}\``);
  }
});

check('🚨 la que no consigue darse de baja va PRIMERA', () => {
  assert(ORDEN_SENAL[0] === 'no_puede_darse_de_baja',
    'es el único motivo que es culpa nuestra y tiene a la mujer esperando: va delante');
});

check('la etiqueta de la atascada dice que el fallo es nuestro', () => {
  assert(/fallo nuestro/i.test(LBL_SENAL.no_puede_darse_de_baja),
    'si la etiqueta no lo dice, se llama como a cualquier otra y se pierde el tono');
});

check('el orden por motivo se aplica DESPUÉS del de antigüedad', () => {
  // `sort` es estable: ordenar por motivo encima conserva la antigüedad dentro de cada
  // grupo. Si se invirtiera, el botón «más antiguas primero» dejaría de hacer nada.
  const iAnt = HTML.indexOf("orden==='antiguas' ? diasEspera(b)");
  const iMot = HTML.indexOf("if(filtro==='senal') VIS = VIS.slice().sort");
  assert(iAnt > 0 && iMot > iAnt, 'el orden por motivo tiene que ir después, no antes');
});

// ── 3. Lo delicado: que nadie salga ni entre dos veces ─────────────────────────────────
grupo('Filtros — que no se duplique ni se cuele trabajo hecho');

// Se extrae el mapeo real del HTML y se ejecuta sobre casos de mentira.
function construirSenales(casos, lista) {
  const nid = v => String(v == null ? '' : v).split('.')[0].trim();
  const yaEnCola = new Set(lista.map(c => nid(c.contract_id) || String(c.customer_id || '') || (c.email || '').toLowerCase()).filter(Boolean));
  const vistos = new Set();
  return casos.filter(s => {
    const k = nid(s.contract_id) || String(s.customer_id || '') || (s.email || '').toLowerCase() || s.telefono || '';
    if (!k || yaEnCola.has(k) || vistos.has(k)) return false; vistos.add(k); return true;
  });
}

check('🚨 una clienta que ya está en la cola NO sale dos veces', () => {
  const r = construirSenales(
    [{ email: 'rosa@mail.com', contract_id: '111' }],
    [{ tipo: 'fallo', contract_id: '111', email: 'rosa@mail.com' }]);
  assert(r.length === 0, 'ya tiene llamada programada por el fallo de pago: verla otra vez es trabajo fantasma');
});

check('cruza también por email cuando no hay contrato', () => {
  const r = construirSenales(
    [{ email: 'Rosa@Mail.com', contract_id: null }],
    [{ tipo: 'baja', contract_id: null, email: 'rosa@mail.com' }]);
  assert(r.length === 0, 'el email tiene que comparar en minúsculas: si no, la misma mujer sale dos veces');
});

check('sin contrato ni email, el teléfono la identifica', () => {
  const r = construirSenales([{ telefono: '34600111222' }, { telefono: '34600111222' }], []);
  assert(r.length === 1, '30 de 139 señales llegan sin email — por teléfono es la única forma de deduplicarlas');
});

check('una señal sin NINGÚN identificador se descarta', () => {
  assert(construirSenales([{}], []).length === 0, 'sin forma de contactarla ni de deduplicarla, no es una llamada');
});

check('una clienta nueva sí entra', () => {
  const r = construirSenales([{ email: 'nueva@mail.com', contract_id: '999' }], [{ contract_id: '111' }]);
  assert(r.length === 1, 'si no está en la cola, tiene que salir');
});

// El filtro de «ya gestionada» que corre en render().
const yaAtendida = (caso, gestiones) =>
  gestiones.some(g => String(g.created_at || '').slice(0, 10) >= String(caso.fecha || ''));

check('si ya la llamaron después de la señal, desaparece del cubo', () => {
  assert(yaAtendida({ fecha: '2026-10-20' }, [{ created_at: '2026-10-21 10:00:00' }]) === true,
    'un caso ya atendido que se queda en la lista acaba haciendo que nadie mire la lista');
});

check('🚨 una llamada ANTERIOR a la señal no la tapa', () => {
  assert(yaAtendida({ fecha: '2026-10-20' }, [{ created_at: '2026-10-05 10:00:00' }]) === false,
    'la llamaron por otra cosa hace 15 días: esta señal sigue sin atender');
});

check('el mismo día cuenta como atendida', () => {
  assert(yaAtendida({ fecha: '2026-10-20' }, [{ created_at: '2026-10-20 18:00:00' }]) === true,
    'la señal salta y la llaman ese mismo día: está hecho');
});

// ── 4. Que no se hinche la cola del día ────────────────────────────────────────────────
grupo('Aislamiento — la decisión de fondo de todo este trabajo');

check('🚨 las señales NO cuentan en «Todas»', () => {
  const linea = (HTML.match(/const counts=\{[^}]*\}/) || [''])[0];
  const todas = (linea.match(/todas:([^,]+)/) || [])[1] || '';
  assert(!/senal/.test(todas),
    '🚨 meter las señales en «Todas» vuelve a hinchar la cola justo después de vaciarla');
});

check('🚨 tampoco entran en la barra del día', () => {
  const linea = HTML.split('\n').find(l => l.includes('const pendientes=vivas.length'));
  assert(linea && !/senal/.test(linea),
    'la barra mide el trabajo cerrable del día; una llamada proactiva no lo es');
});

check('no se filtran por dueña (si no, serían cero para todas)', () => {
  const linea = HTML.split('\n').find(l => l.includes('const senales = dfil(SENALES)'));
  assert(linea && !/\bvd\(/.test(linea),
    '🚨 la estación abre en «Mías» y estos casos no tienen asignación: con vd() nadie los vería');
});

const color = ko === 0 ? C.g : C.r;
console.log(`\n${color}${C.b}${ok} OK · ${ko} KO${C.x}\n`);
process.exit(ko === 0 ? 0 : 1);
