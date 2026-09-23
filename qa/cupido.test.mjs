#!/usr/bin/env node
/**
 * CUPIDO — test de regresión de la estación de llamadas.
 *
 *   node qa/cupido.test.mjs           → sólo lógica (offline, rápido)
 *   node qa/cupido.test.mjs --prod    → además, humo contra producción
 *
 * Extrae el CATÁLOGO y las funciones REALES de llamadas/index.html en vez de copiarlas:
 * si alguien las renombra o las mueve, el test revienta en vez de seguir validando una
 * copia vieja. Ese era el fallo de las baterías anteriores (qa_worker.mjs, qa_front.mjs).
 *
 * Qué protege: la máquina de estados de un resultado de gestión, que es donde se decide
 * si una clienta se llama, espera o se cierra. Tres bugs reales salieron de ahí:
 *   · las pagadas volvían cada mañana (y a la vez en «Contactadas»)
 *   · un ajuste de duplicada resuelto se volvía a llamar dos días después
 *   · un «cobro hecho» sin validar reaparecía en la lista de llamadas
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FICHERO = path.join(RAIZ, 'llamadas', 'index.html');
const PROD = process.argv.includes('--prod');

// ── Extracción del fuente real ────────────────────────────────────────
const HTML = fs.readFileSync(FICHERO, 'utf8');
const SRC = [...HTML.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

/** Saca una declaración completa equilibrando llaves desde su inicio. */
function extraer(decl) {
  const i = SRC.indexOf(decl);
  if (i < 0) throw new Error(`No encuentro «${decl}» en llamadas/index.html — ¿lo han renombrado?`);
  let j = SRC.indexOf('{', i), prof = 0;
  if (j < 0) throw new Error(`«${decl}» sin cuerpo`);
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') prof++;
    else if (SRC[j] === '}' && --prof === 0) return SRC.slice(i, j + 1);
  }
  throw new Error(`«${decl}» con llaves sin cerrar`);
}
/** Saca una línea suelta (arrow de una línea, Set, etc.). */
function linea(prefijo) {
  const re = new RegExp('^\\s*' + prefijo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*$', 'm');
  const m = SRC.match(re);
  if (!m) throw new Error(`No encuentro la línea «${prefijo}» — ¿la han cambiado?`);
  return m[0];
}

const PIEZAS = [
  extraer('const CATALOGO='),
  linea('const WINS='), linea('const RES_LABEL='), linea('const RES_TONE='),
  linea('const CANCELA_APPSTLE='), linea('const CIERRA='), linea('const ESPERA='),
  linea('const COBRO_HECHO='), linea('const CANCELAR='),
  linea('const TERMINAL='), linea('const nid='), linea('const hoyISO='), linea('const esc='),
  linea('const fechaCorta='),
  extraer('function histDe'), extraer('function gestionadaHoy'),
  extraer('function casoCerrado'), extraer('function enEspera'),
  extraer('function yaRegistrada'), extraer('function gestionadasCards'),
];

// Sandbox: sólo el estado que necesitan las funciones extraídas.
const sandbox = { GEST: { byC: {}, byCust: {} }, GALL: [], FSEEN: {} };
const cargar = new Function('estado', `
  let { GEST, GALL, FSEEN } = estado;
  ${PIEZAS.join('\n')}
  return { CATALOGO, TERMINAL, CIERRA, ESPERA, COBRO_HECHO,
           gestionadaHoy, casoCerrado, enEspera, yaRegistrada, gestionadasCards,
           set(e){ GEST = e.GEST || {byC:{},byCust:{}}; GALL = e.GALL || []; FSEEN = e.FSEEN || {}; } };
`);
const API = cargar(sandbox);

// ── Utilidades del test ───────────────────────────────────────────────
const d = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
let ok = 0, ko = 0;
const t = (nombre, cond) => { cond ? ok++ : ko++; console.log(`  ${cond ? '✅' : '❌'} ${nombre}`); };
const bloque = n => console.log(`\n${n}`);
/** Monta el estado: gestiones de UN contrato, más recientes primero (como llega de la API). */
function conGestiones(gestiones, fseen) {
  const g = gestiones.map(x => ({ contract_id: '1', es_test: 0, contacto: 'localizada', ...x }))
                     .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  API.set({ GEST: { byC: { '1': g }, byCust: {} }, GALL: g, FSEEN: fseen || {} });
}
const CASO = { contract_id: '1', first_seen: d(9), fecha: d(9) };
/** ¿Sale hoy en «por llamar»? (mismo filtro que render()) */
const porLlamar = c => !API.gestionadaHoy(c) && !API.yaRegistrada(c) && !API.casoCerrado(c) && !API.enEspera(c);

// ── 1. El catálogo declara lo que creemos ─────────────────────────────
bloque('CATÁLOGO — quién cierra, quién espera, quién vuelve');
t('`pagado` y `ajuste_duplicada` cierran el caso',
  API.CIERRA.has('pagado') && API.CIERRA.has('ajuste_duplicada'));
t('`cobro_manual` y `actualizar_pago` esperan validación',
  API.ESPERA.has('cobro_manual') && API.ESPERA.has('actualizar_pago'));
t('un cobro a la espera NO cierra el caso (si no, se perdería sin validar)',
  !API.CIERRA.has('cobro_manual') && !API.CIERRA.has('actualizar_pago'));
t('los intentos NO cierran ni esperan — deben volver mañana',
  ['intento_1','intento_2'].every(k => !API.CIERRA.has(k) && !API.ESPERA.has(k) && API.TERMINAL.has(k)));
t('`cobro_no_confirmado` existe y devuelve a la lista',
  !!API.CATALOGO.cobro_no_confirmado && !API.CIERRA.has('cobro_no_confirmado') && !API.ESPERA.has('cobro_no_confirmado'));
t('`cobro_no_confirmado` no es botón de nadie: sólo lo pone el cron',
  !/'cobro_no_confirmado'/.test((SRC.match(/codigos=\[[^\]]*\]/g) || []).join(' ')));

// ── 2. Qué vuelve a la lista y qué no ─────────────────────────────────
bloque('POR LLAMAR — qué reaparece al día siguiente');
conGestiones([{ resultado: 'intento_1', created_at: d(1) + ' 09:00' }]);
t('intento de ayer → vuelve (es el diseño, no tocar)', porLlamar(CASO));
conGestiones([{ resultado: 'intento_1', created_at: d(0) + ' 09:00' }]);
t('intento de hoy → fuera del día', !porLlamar(CASO));
conGestiones([{ resultado: 'ajuste_duplicada', created_at: d(2) + ' 14:00' }]);
t('ajuste de duplicada → cerrado, no vuelve  [caso Elisa]', !porLlamar(CASO));
conGestiones([{ resultado: 'cobro_manual', created_at: d(2) + ' 10:00' }]);
t('cobro hecho → no vuelve…', !porLlamar(CASO));
t('…pero el caso sigue ABIERTO esperando validación', !API.casoCerrado(CASO) && API.enEspera(CASO));
conGestiones([{ resultado: 'pagado', created_at: d(2) + ' 10:00' }]);
t('validado «pagado» → cerrado', API.casoCerrado(CASO) && !porLlamar(CASO));
conGestiones([{ resultado: 'cobro_no_confirmado', created_at: d(1) + ' 10:00' }]);
t('el cron no lo confirmó → vuelve a la lista', porLlamar(CASO));

// ── 3. El ancla de episodio: lo viejo no tapa lo nuevo ────────────────
bloque('ANCLA DE EPISODIO — un desenlace viejo no puede tapar un impago nuevo');
const NUEVO = { contract_id: '1', first_seen: d(3), fecha: d(3) };
conGestiones([{ resultado: 'pagado', created_at: d(60) + ' 10:00' }], { '1': d(3) });
t('pagó hace 60 días y vuelve a fallar → se llama', porLlamar(NUEVO));
conGestiones([{ resultado: 'ajuste_duplicada', created_at: d(60) + ' 10:00' }], { '1': d(3) });
t('ajuste de hace 60 días → se llama', porLlamar(NUEVO));
conGestiones([{ resultado: 'cobro_manual', created_at: d(70) + ' 10:00' }], { '1': d(3) });
t('cobro de hace 70 días → se llama', porLlamar(NUEVO));

// ── 4. Manda la gestión más reciente del episodio ─────────────────────
bloque('ORDEN — lo último que pasó es lo que vale');
conGestiones([{ resultado: 'cobro_manual', created_at: d(4) + ' 10:00' },
              { resultado: 'intento_1',    created_at: d(1) + ' 09:00' }]);
t('tras un cobro, un intento nuevo la devuelve al juego', porLlamar(CASO));
conGestiones([{ resultado: 'cobro_manual', created_at: d(4) + ' 10:00' },
              { resultado: 'cancelacion',  created_at: d(1) + ' 10:00' }]);
t('una cancelación posterior manda sobre el cobro', !API.enEspera(CASO));

// ── 5. Cómo se representa a la clienta en los listados ────────────────
bloque('LISTADOS — la tarjeta dice lo que de verdad pasó');
conGestiones([{ resultado: 'ajuste_duplicada', created_at: d(7) + ' 14:00', email: 'a@t.com' },
              { resultado: 'intento_1',        created_at: d(5) + ' 09:00', email: 'a@t.com' }], { '1': d(9) });
t('el cierre manda sobre el intento posterior  [caso Elisa]',
  API.gestionadasCards()[0].why.includes('Ajuste cuenta duplicada'));
conGestiones([{ resultado: 'pagado',    created_at: d(60) + ' 10:00', email: 'a@t.com' },
              { resultado: 'intento_1', created_at: d(1)  + ' 09:00', email: 'a@t.com' }], { '1': d(3) });
t('en un episodio NUEVO la tarjeta no puede decir «Pagado»',
  !API.gestionadasCards()[0].esPagado);
conGestiones([{ resultado: 'cobro_manual', created_at: d(2) + ' 10:00', email: 'a@t.com' }]);
t('un cobro sin validar sigue contando en «Pagos por validar»',
  API.gestionadasCards()[0].esCobroHecho);

// ── 6. Humo contra producción (opcional) ──────────────────────────────
if (PROD) {
  bloque('PRODUCCIÓN — endpoints y páginas vivas');
  const API_BAJAS = 'https://manage.wearedomma.com';
  const pedir = async (u, o) => { try { return await fetch(u, { signal: AbortSignal.timeout(30000), ...o }); }
                                  catch { return { ok: false, status: 0 }; } };
  for (const [nombre, ruta] of [['asignar', '/api/dashboard/asignar'], ['fallos-sync', '/api/dashboard/fallos-sync'],
                                ['gestion', '/api/dashboard/gestion']]) {
    const r = await pedir(API_BAJAS + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    t(`${nombre} exige credenciales (401)`, r.status === 401);
  }
  const qa = await pedir(API_BAJAS + '/api/dashboard/qa-autovalidar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  t('la ruta QA temporal sigue borrada (404)', qa.status === 404);

  const hoy = await pedir('https://gestorsubs-domma.cristina-ed1.workers.dev/today');
  let vivos = null;
  if (hoy.ok) { const j = await hoy.json(); vivos = (j.failed || []).length + (j.dunning_skipped || []).length;
    t(`/today responde y trae fallos vivos (${vivos})`, vivos > 0);
    t('/today trae contract_status (lo necesita «Ha pagado»)',
      [...(j.failed || []), ...(j.dunning_skipped || [])].every(f => 'contract_status' in f));
  } else t('/today responde', false);

  const pag = await pedir('https://data.wearedomma.com/llamadas/?_qa=' + Date.now());
  const html = pag.ok ? await pag.text() : '';
  t('la estación en vivo sirve el código de este repo',
    html.includes('casoCerrado') && html.includes('enEspera') && html.includes('cobro_no_confirmado'));
  t('ya no queda el desplegable «Soy:» (la identidad sale del login)',
    !html.includes('domma_agente'));
}

// ── Resultado ─────────────────────────────────────────────────────────
console.log(`\n${ok} OK · ${ko} KO${PROD ? '' : '   (añade --prod para el humo contra producción)'}`);
process.exit(ko ? 1 : 0);
