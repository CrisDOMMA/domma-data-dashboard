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

/** Saca una declaración completa equilibrando su primer bloque, sea {…} o […]. */
function extraer(decl) {
  const i = SRC.indexOf(decl);
  if (i < 0) throw new Error(`No encuentro «${decl}» en llamadas/index.html — ¿lo han renombrado?`);
  const llave = SRC.indexOf('{', i), cor = SRC.indexOf('[', i);
  const abre = (cor >= 0 && (llave < 0 || cor < llave)) ? '[' : '{';
  const cierra = abre === '[' ? ']' : '}';
  let j = SRC.indexOf(abre, i), prof = 0;
  if (j < 0) throw new Error(`«${decl}» sin cuerpo`);
  for (; j < SRC.length; j++) {
    if (SRC[j] === abre) prof++;
    else if (SRC[j] === cierra && --prof === 0) return SRC.slice(i, j + 1);
  }
  throw new Error(`«${decl}» sin cerrar`);
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
  extraer('const EQUIPO='),
  linea('const asigDe'), linea('const duenoDe'), linea('const esMio'), linea('const sinDueno'),
  extraer('function yo'), linea('function agActual'),
  extraer('function botonesAsignacion'), extraer('function filtrarPorDueno'),
  linea('let verDe ='),
  extraer('function histDe'), extraer('function gestionadaHoy'),
  extraer('function casoCerrado'), extraer('function enEspera'),
  extraer('function yaRegistrada'), linea('const SALVA='), extraer('function yaSalvada'),
  extraer('function gestionadasCards'), extraer('function nivelIrse'), extraer('function compararSenales'), extraer('function prioridad'), extraer('function compraCerrada'), extraer('function fichaCompra'),
  linea('const BIENV_MAX_INTENTOS='), extraer('function diaSiguienteHabil'), extraer('function bienvenidaCerrada'), extraer('function calidadCerrada'), linea('const MOTIVO_DIFICIL='), extraer('function nivelRescate'), extraer('function marcaRescate'),
  linea('const soloDig='), linea('const sinPre ='), extraer('const matchB='),
].filter(Boolean);

// Sandbox: sólo el estado que necesitan las funciones extraídas.
const sandbox = { GEST: { byC: {}, byCust: {} }, GALL: [], FSEEN: {}, ASIG: {},
  token: 'x.' + Buffer.from(JSON.stringify({ nombre: 'Valentina', email: 'compras@wearedomma.com', role: 'retencion' })).toString('base64') + '.y' };
const cargar = new Function('estado', `
  let { GEST, GALL, FSEEN, ASIG, token } = estado;
  const atob = b => Buffer.from(b, 'base64').toString('utf8');
  const localStorage = { getItem: () => null, setItem() {} };   // arranque limpio
  let busca = '';
  ${PIEZAS.join('\n')}
  return { nivelIrse, compararSenales, prioridad, compraCerrada, fichaCompra, CATALOGO, TERMINAL, CIERRA, ESPERA, COBRO_HECHO, EQUIPO,
           gestionadaHoy, casoCerrado, enEspera, yaRegistrada, yaSalvada, gestionadasCards, bienvenidaCerrada, calidadCerrada, nivelRescate, marcaRescate, diaSiguienteHabil,
           botonesAsignacion, duenoDe, sinDueno, esMio, agActual, filtrarPorDueno,
           verDePorDefecto: () => verDe,
           conVerDe(v){ verDe = v; },
           busca(q, caso){ busca = String(q||'').toLowerCase().trim(); return matchB(caso); },
           set(e){ GEST = e.GEST || {byC:{},byCust:{}}; GALL = e.GALL || []; FSEEN = e.FSEEN || {}; ASIG = e.ASIG || {}; } };
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
  const byCust={}; for(const x of g) if(x.customer_id) (byCust[String(x.customer_id)]??=[]).push(x);
  API.set({ GEST: { byC: { '1': g }, byCust }, GALL: g, FSEEN: fseen || {} });
}
const CASO = { contract_id: '1', first_seen: d(9), fecha: d(9) };
/** ¿Sale hoy en «por llamar»? (mismo filtro que render()) */
const porLlamar = c => !API.gestionadaHoy(c) && !API.yaRegistrada(c) && !API.casoCerrado(c) && !API.enEspera(c) && !API.yaSalvada(c);

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

// ── 3b. Lo salvado no vuelve a la lista (decisión Cristina 27/10) ─────
bloque('RETENIDAS — una clienta salvada deja de aparecer como pendiente');
conGestiones([{ resultado: 'retenida', created_at: d(2) + ' 10:00' }]);
t('retenida hace 2 días → no vuelve  [caso Guadalupe]', !porLlamar(CASO));
conGestiones([{ resultado: 'pausa', created_at: d(2) + ' 10:00' }]);
t('pausada → no vuelve cada mañana (su recontacto entra por Agendadas)', !porLlamar(CASO));
conGestiones([{ resultado: 'cambio_producto', created_at: d(2) + ' 10:00' }]);
t('un cambio de producto también es retención', !porLlamar(CASO));
conGestiones([{ resultado: 'retenida', created_at: d(60) + ' 10:00' }], { '1': d(3) });
t('retenida hace 60 días y vuelve a entrar → se llama (ancla de episodio)', porLlamar(NUEVO));
conGestiones([{ resultado: 'retenida',  created_at: d(4) + ' 10:00' },
              { resultado: 'intento_1', created_at: d(1) + ' 09:00' }]);
t('tras la retención, un intento nuevo la devuelve al juego', porLlamar(CASO));
t('render() descarta de verdad las ya salvadas', /&& !yaSalvada\(c\)/.test(SRC));

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
conGestiones([{ tipo_caso: 'bienvenida', resultado: 'bienvenida_no_contesta', contacto: 'no_localizada', created_at: d(1) + ' 10:00', email: 'a@t.com' }]);
t('una bienvenida ya llamada sigue siendo bienvenida al re-registrar  [bug Carme 18/11]',
  API.gestionadasCards()[0].tipo === 'bienvenida' && API.gestionadasCards()[0].esBienvenida);
conGestiones([{ tipo_caso: 'derivada', resultado: 'retenida', created_at: d(1) + ' 10:00', email: 'a@t.com' }]);
t('una derivada ya gestionada sigue siendo derivada', API.gestionadasCards()[0].tipo === 'derivada');

// ── 6. Reparto de casos entre el equipo ──────────────────────────────
bloque('ASIGNACIÓN — se reparten fallos, bajas Y derivadas');
API.set({ ASIG: { '502': { agente: 'Martina' }, '503': { agente: 'Valentina' } } });
const conBotones = c => API.botonesAsignacion(c, 0);
// Carme, no Ana: `ayuda@` se renombró el 02/10 (ver bloque PSEUDÓNIMOS más abajo).
t('el equipo son las tres', API.EQUIPO.map(p => p.nombre).sort().join() === 'Carme,Martina,Valentina');
for (const tipo of ['fallo', 'baja', 'derivada'])
  t(`un caso de tipo «${tipo}» se puede repartir`, conBotones({ tipo, contract_id: '999' }).includes('Coger'));
t('una derivada de otra se puede pasar, no coger',
  !conBotones({ tipo: 'derivada', contract_id: '502' }).includes('Coger') &&
   conBotones({ tipo: 'derivada', contract_id: '502' }).includes('Pasar a'));
t('las tarjetas de sólo consulta del registro no se reparten',
  conBotones({ tipo: 'baja', contract_id: '999', registro: true }) === '');
t('sin contrato no hay con qué identificar el caso → sin botones',
  conBotones({ tipo: 'derivada', contract_id: '' }) === '');
t('«sin dueño» reconoce una derivada libre', API.sinDueno({ contract_id: '999' }));
t('«míos» reconoce la derivada de Valentina', API.esMio({ contract_id: '503' }));
t('…y no la de Martina', !API.esMio({ contract_id: '502' }));
API.set({});

// ── 7. La lista de cada una, y lo agendado que ya toca ───────────────
bloque('LA LISTA DE CADA UNA — cada persona entra a lo suyo');
t('al entrar, la lista arranca en «Mías»', API.verDePorDefecto() === '__mias__');
API.set({ ASIG: { a: { agente: 'Ana' }, m: { agente: 'Martina' } } });
const casos = [{ contract_id: 'a' }, { contract_id: 'm' }, { contract_id: 'x' }];
API.conVerDe('__mias__');
t('«Mías» (sesión de Valentina) no trae nada ajeno', API.filtrarPorDueno(casos).length === 0);
API.conVerDe('Ana');
t('se puede ver la lista de Ana', API.filtrarPorDueno(casos).map(c => c.contract_id).join() === 'a');
API.conVerDe('Martina');
t('…y la de Martina', API.filtrarPorDueno(casos).map(c => c.contract_id).join() === 'm');
API.conVerDe('__libre__');
t('…y el pozo sin dueño', API.filtrarPorDueno(casos).map(c => c.contract_id).join() === 'x');
API.conVerDe('');
t('«Todas» no filtra nada', API.filtrarPorDueno(casos).length === 3);
API.conVerDe('__mias__'); API.set({});

bloque('AGENDADAS — una llamada con fecha no se pierde');
const hoy = new Date().toISOString().slice(0, 10);
const manana = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const agendable = (prox, res = 'pausa') => { conGestiones([{ resultado: res, created_at: d(20) + ' 10:00', proxima_llamada: prox, email: 'a@t.com' }]); return API.gestionadasCards()[0]; };
t('una agendada para hoy es trabajo de hoy', agendable(hoy).prox.slice(0, 10) === hoy);
t('una vencida avisa de que venció, no dice «próx.»', agendable(d(2)).why.includes('venció'));
t('una futura sí dice «próx.»', agendable(manana).why.includes('próx.'));
t('el catálogo mantiene los seguimientos que generan fecha',
  !!API.CATALOGO.pausa && !!API.CATALOGO.segunda_llamada);
// La fuente de la verdad del cubo: sale de la gestión, no de la tarjeta viva
t('el cubo de agendadas se construye con `prox` <= hoy y sin duplicar lo vivo',
  /agendadas\s*=[\s\S]{0,400}?prox[\s\S]{0,200}?hoyISO\(\)[\s\S]{0,200}?yaEnVivas/.test(SRC));
t('«Derivadas» ya no cuenta las que están en «Agendadas»',
  /pausasFuturas\s*=\s*pausas\.filter\(c=>!yaAgendadas/.test(SRC));

// ── 7b. BUSCADOR — «no encuentra a la clienta» (reportado 29/09) ──────
// Dos fallos distintos, los dos reales:
//   1) el corpus se construía desde los cubos YA filtrados por dueña, así que desde que la
//      estación abre en «Mías» buscar a una clienta de otra compañera devolvía vacío;
//   2) el móvil se comparaba como texto crudo, y llega en formatos distintos según la fuente.
bloque('BUSCADOR — encontrar a la clienta, sea de quien sea');

const CLI = { nombre: 'Teresa Agulló Gil', email: 'tagullo@gmail.com', phone: '+34687233734' };
const SHOP = { nombre: 'Eva', email: 'eva@gmail.com', phone: '+34 655 67 29 08' };  // así lo da Shopify
const PELA = { nombre: 'Sandra', email: 's@gmail.com', phone: '667156008' };        // así lo da el formulario

t('encuentra por email', API.busca('tagullo@gmail.com', CLI));
t('encuentra por nombre, sin importar mayúsculas', API.busca('TERESA AGULLÓ', CLI));
t('encuentra el móvil tecleado sin prefijo aunque esté guardado con +34',
  API.busca('687233734', CLI));
t('encuentra el móvil de Shopify (con espacios) tecleando sólo los dígitos',
  API.busca('655672908', SHOP));
t('encuentra tecleando con +34 aunque esté guardado a pelo',
  API.busca('+34667156008', PELA));
t('encuentra tecleando el móvil con espacios, como lo dicta la clienta',
  API.busca('687 23 37 34', CLI));
t('no inventa coincidencias con un número corto (2 dígitos no son un teléfono)',
  !API.busca('67', { nombre: 'Otra', email: 'o@x.com', phone: '+34911223344' }));
t('sigue sin encontrar a quien no es', !API.busca('mercedes', CLI));

// La regresión de fondo: el corpus NO puede salir de los cubos filtrados por dueña/fecha.
const bloqueBusca = (SRC.match(/if\(busca\)\{[\s\S]{0,1600}?\n\s*\}\s*else if/) || [''])[0];
t('el corpus de búsqueda sale de LISTA + gestionadasCards() + REGISTRO, sin filtrar',
  /\.\.\.LISTA/.test(bloqueBusca) && /gestionadasCards\(\)/.test(bloqueBusca) && /\.\.\.REGISTRO/.test(bloqueBusca));
t('la búsqueda NO hereda «La lista de: …» ni el filtro de fecha',
  !/\bvivas\b|\bcontactadas\b|\bnolocal\b|\bporRegistrar\b|\bagendadas\b|\breg\b/.test(bloqueBusca));
t('filtrarPorDueno sigue gobernando la lista del día (no se ha desactivado)',
  /vivas\s*=\s*vd\(vivas\)/.test(SRC) && /const vd\s*=\s*l=>filtrarPorDueno/.test(SRC));

// ── 7c. CASOS CERRADOS — registrar la llamada sin ejecutar nada (29/09) ──
// Carme: «no em deixa CUPIDO seleccionar l'opció de tancament. Si he localizat o no, si he fet
// una trucada o dos». La tarjeta de sólo consulta no tenía botón «Registrar», así que 176
// mujeres que pidieron la baja y acabaron canceladas eran irregistrables: si alguien las
// llamaba, el trabajo existía y el dato no.
bloque('CASOS CERRADOS — que se pueda registrar la llamada');

const WORKER = fs.readFileSync(
  path.join(RAIZ, '..', 'flujo-bajas', 'worker', 'src', 'index.js'), 'utf8');
const SRC_WEB = fs.readFileSync(
  path.join(RAIZ, '..', 'flujo-bajas', 'web', 'index.html'), 'utf8');

t('la tarjeta de consulta CON contrato ya ofrece «Registrar»',
  /\$\{\(c\.registro && !nid\(c\.contract_id\)\)\?''/.test(SRC));
t('…y sin contrato sigue sin ofrecerlo (no hay dónde colgar la gestión)',
  /!nid\(c\.contract_id\)/.test(SRC));
t('un registro en un caso cerrado se puede deshacer',
  /const ultGestId = c\.gestId/.test(SRC) && !/const ultGestId = !c\.registro/.test(SRC));
t('el front avisa de que en un caso cerrado no se toca Appstle',
  /No cambia nada en Appstle/.test(SRC));
t('el front manda `solo_registro` al guardar',
  /solo_registro:soloRegistro/.test(SRC));
t('no se enseña el aviso de cancelación real cuando sólo se registra',
  /CANCELA_APPSTLE\.has\(resultado\) && !soloRegistro/.test(SRC));
t('ni el de pausa real', /resultado==='pausa' && !editId && !soloRegistro/.test(SRC));

t('el worker NO cancela en Appstle si viene `solo_registro`',
  /RESULTADOS_CANCELAN\.has\(resultado\) && !b\.es_test && !soloRegistro/.test(WORKER));
t('el worker NO mueve el cobro si viene `solo_registro`',
  /resultado === "pausa" && !b\.es_test && contractId && prox && !soloRegistro/.test(WORKER));
t('…pero la gestión se guarda igual (el INSERT no depende del flag)',
  /const soloRegistro = !!b\.solo_registro/.test(WORKER)
  && WORKER.indexOf('const soloRegistro') < WORKER.indexOf('INSERT INTO gestiones'));
t('el email de 72h sigue atado SÓLO a fallo_pago + intento_2',
  /tipo === "fallo_pago" && resultado === "intento_2"/.test(WORKER));

// ── 7d. SOLICITUDES — dedupear antes de cortar, y no callar el tope ───
bloque('SOLICITUDES — el tope cuenta mujeres, no pulsaciones');
t('ya no se corta a 60 filas antes de dedupear',
  !/accion_final === "solicitud_baja"\)[\s\S]{0,200}?\.slice\(0, 60\)/.test(WORKER));
t('se agrupa por clienta ANTES de aplicar el tope',
  WORKER.indexOf('porClienta.set') < WORKER.indexOf('todas.slice(0, MAX_SOLICITUDES)'));
t('el tope es de clientas y sube a 200', /MAX_SOLICITUDES = 200/.test(WORKER));
t('se queda con la solicitud MÁS RECIENTE de cada clienta',
  /String\(x\.created_at \|\| ""\) > String\(prev\.created_at \|\| ""\)/.test(WORKER));
t('lo que el tope descarta se publica, no se calla',
  /solicitudes\.descartadas = solicitudes_descartadas/.test(WORKER)
  && /solicitudes\.total_clientas = todas\.length/.test(WORKER));

// ── 7e. «reactivada después» tiene que significar después ─────────────
bloque('REACTIVADA — «después» significa después');
t('se guarda la FECHA de la reactivación, no sólo que exista',
  /MAX\(COALESCE\(occurred_at, received_at\)\)/.test(WORKER) && /reactivadosMap/.test(WORKER));
t('el flag compara con la fecha de la solicitud',
  /reactivada: reactivadaDespues\(r\.customer_id, r\.created_at\)/.test(WORKER));
t('sin fecha de reactivación, no se marca',
  /if \(!ult\) return false/.test(WORKER));
t('ya no queda el Set antiguo sin fechas', !/reactivadosSet/.test(WORKER));

// ── 7f. PSEUDÓNIMOS — dos planos que no hay que «unificar» (02/10) ────
// DOMMA usa pseudónimos: `ayuda@` es **Carme** dentro del equipo y **Marta** (la coach) de
// cara a la clienta. Es la misma persona. La etiqueta «Ana» se retiró. Que la estación diga
// Carme y los correos digan Marta NO es una incoherencia: es nombre interno vs nombre real.
// Este bloque existe para que quien vea los dos nombres no los «arregle».
bloque('PSEUDÓNIMOS — Carme dentro, Marta de cara a la clienta');

t('el equipo de la estación es Carme · Valentina · Martina',
  /nombre:'Carme',\s*email:'ayuda@wearedomma\.com'/.test(SRC)
  && /nombre:'Valentina'/.test(SRC) && /nombre:'Martina'/.test(SRC));
t('«Ana» ya no figura como miembro del equipo',
  !/nombre:'Ana'/.test(SRC));
t('las derivadas de coaching se rotulan a Carme, no a Ana',
  /Derivada a Carme/.test(SRC) && !/Derivada a Ana/.test(SRC));
t('los correos a la clienta nombran a Marta, que es la coach real',
  (WORKER.match(/botonAgenda\("Agendar una sesión con Marta"\)/g) || []).length === 4
  && !/sesión con Ana/.test(WORKER));
t('…y el enlace de agenda sigue siendo el calendario compartido «Coach Domma»',
  /AGENDA_COACH = "https:\/\/calendar\.app\.google\/ZVoMELJseJ8TBZMg7"/.test(WORKER));
t('el worker normaliza los alias retirados al ESCRIBIR (sesiones cacheadas)',
  /const ALIAS_AGENTE = \{ Ana: "Carme"/.test(WORKER)
  && /normAgente\(b\.agente\)\.slice\(0, 60\)/.test(WORKER)
  && /const agente = normAgente\(b\.agente\)/.test(WORKER));
t('…porque el JWT se cachea y una sesión abierta sigue firmando con el nombre viejo',
  /se cachea en el navegador/.test(WORKER));
t('queda escrito POR QUÉ los dos nombres conviven (si no, alguien los unifica)',
  /PSEUDÓNIMOS/.test(WORKER) && /PSEUDÓNIMOS/.test(SRC));

// ── 7g. LA BAJA SE COMPLETA EN EL FORMULARIO (22/10, tarde) ──────────
// El formulario ES la vía de baja: la clienta la termina ahí y el motivo queda registrado,
// que es lo que hacía falta para medir. A la estación solo llega lo que el gate S19 frena y
// los fallos de pago.
//
// Esto se tocó DOS veces el 22/10: por la mañana se mandaron todas las médicas a Carme sin
// cancelar, y por la tarde se revirtió. Razón de la vuelta atrás: obligar a esperar una
// llamada dejaba a la clienta sin salida — 9 escribieron «no puedo darme de baja» en un mes,
// una de ellas lo intentó 10 veces en una hora cambiando de motivo. Y el muro no retiene:
// 7 de esas 9 acabaron canceladas igual, solo que enfadadas y por WhatsApp.
bloque('BAJA — se completa en el formulario, no en una llamada');

t('«Continuar con mi baja» EJECUTA la baja, no abre una solicitud',
  /onclick="action\('baja'\)">Continuar con mi baja/.test(SRC_WEB)
  && !/onclick="solicitarBaja\(\)"/.test(SRC_WEB));
t('ya no queda la función que la convertía en solicitud de 72h',
  !/function solicitarBaja\(/.test(SRC_WEB));
t('la pantalla médica vuelve a ofrecer la baja inmediata',
  /onclick="action\('baja'\)">Darme de baja ahora/.test(SRC_WEB));
t('…y mantiene la alternativa de llamada, sin obligar a ella',
  /Prefiero que me llaméis/.test(SRC_WEB));
t('el aviso de la ventana de 5 días sigue en la pantalla médica',
  /\$\{avisoRenovacion\(\)\}[\s\S]{0,200}Darme de baja ahora/.test(SRC_WEB));
t('una baja médica se cancela sola con 2 pedidos (no exige los 2 meses)',
  /esBajaMedica\s*\n?\s*\?\s*\(esTestCust \|\| t\.pedidos >= Number\(env\.MIN_PEDIDOS\)\)/.test(WORKER));
t('el gate S19 sigue en pie para el resto de motivos',
  /: cumpleMinimo\(env, c, t, customerId\)/.test(WORKER));
t('el motivo se sigue registrando al cancelar (es para lo que se mide)',
  /motivo:STATE\.motivo/.test(SRC_WEB));

// ── 7h. EL RELOJ DE LAS MÉDICAS (22/10) ──────────────────────────────
// Desde que las médicas no se auto-cancelan, la clienta sigue ACTIVA hasta que la llamen y
// le hemos prometido por escrito «menos de 72h». Si se pasa, se le cobra y se le envía otra
// vez un producto que dice que le sienta mal — y ya no tiene botón para pararlo. El aviso a
// las 48h deja 24h de margen. Sin esto, el plazo depende de que alguien se acuerde.
bloque('MÉDICAS — el reloj de las 72h');

t('se avisa a las 48h y el límite es 72h',
  /MEDICO_AVISO_H = 48, MEDICO_LIMITE_H = 72/.test(SRC));
t('se reconoce como médica por motivo o por el comentario del worker',
  /\['salud','incompatible'\]\.includes\(s\.motivo\)/.test(SRC)
  && /\(s\.comentario\|\|''\)==='motivo_medico'/.test(SRC));
t('el reloj cuenta en HORAS, no en días (72h no es «3 días»)',
  /Math\.floor\(\(Date\.now\(\)-d\.getTime\(\)\)\/3600000\)/.test(SRC));
t('la fecha se interpreta como UTC, no como hora local',
  /replace\(' ','T'\)\+\(String\(f\)\.length<=16\?':00Z':'Z'\)/.test(SRC));
t('la tarjeta se pone ROJA al pasar de 72h y ámbar al pasar de 48h',
  /c\.medico&&c\.horas>=MEDICO_LIMITE_H\)\?'red':\(c\.medico&&c\.horas>=MEDICO_AVISO_H\)\?'amber'/.test(SRC));
t('el reloj se pinta en el texto de la tarjeta',
  /\$\{esc\(relojMedico\(c\)\)\}/.test(SRC));
t('las médicas tienen cubo y chip propios (en Derivadas se pierden entre ~100)',
  /\['medicas','🩺 Médicas'\]/.test(SRC) && /filtro==='medicas'\)\{ VIS=medicas; \}/.test(SRC));
t('las más viejas salen primero',
  /medicas\s*=\s*vd\(vivas\.filter\(x=>x\.medico\)\)\.sort\(\(a,b\)=>\(b\.horas\|\|0\)-\(a\.horas\|\|0\)\)/.test(SRC));
t('la barra del día canta las vencidas',
  /medVencidas[\s\S]{0,160}pasa\$\{medVencidas===1\?'':'n'\} de 72 h/.test(SRC));


// ── 👋 Bienvenidas: llamada de onboarding a las altas (16/11/2026) ────
bloque('BIENVENIDAS — quién sale del cubo y qué NO puede romper');
{
  const B = { tipo: 'bienvenida', bienvenida: true, contract_id: '1', alta: d(8), fecha: d(4) };
  const NC = { tipo_caso: 'bienvenida', resultado: 'bienvenida_no_contesta', contacto: 'no_localizada' };
  conGestiones([]);
  t('sin gestiones → hay que llamarla', !API.bienvenidaCerrada(B));
  conGestiones([{ tipo_caso: 'bienvenida', resultado: 'bienvenida_bien', created_at: d(1) + ' 10:00' }]);
  t('se habló con ella → sale', API.bienvenidaCerrada(B));
  conGestiones([{ ...NC, created_at: d(3) + ' 10:00', proxima_llamada: d(0) }]);
  t('no contestó y la 2ª llamada es HOY → vuelve', !API.bienvenidaCerrada(B));
  conGestiones([{ ...NC, created_at: d(3) + ' 10:00', proxima_llamada: d(1) }]);
  t('2ª llamada vencida (era ayer) → sigue saliendo, no se pierde', !API.bienvenidaCerrada(B));
  conGestiones([{ ...NC, created_at: d(0) + ' 10:00', proxima_llamada: d(-2) }]);
  t('2ª llamada para pasado mañana → no sale todavía', API.bienvenidaCerrada(B));
  conGestiones([{ ...NC, created_at: d(0) + ' 10:00' }]);
  t('no contestó hoy y sin fecha → fuera del día', API.bienvenidaCerrada(B));
  conGestiones([{ ...NC, created_at: d(2) + ' 10:00' }, { ...NC, created_at: d(1) + ' 10:00' }]);
  t('dos sin respuesta → no se insiste más', API.bienvenidaCerrada(B));
  conGestiones([{ tipo_caso: 'baja', resultado: 'retenida', created_at: d(40) + ' 10:00' }]);
  t('una llamada ANTERIOR al alta (otra suscripción) no la esconde', !API.bienvenidaCerrada(B));
  conGestiones([{ tipo_caso: 'bienvenida', resultado: 'cancelacion', created_at: d(1) + ' 10:00' }]);
  t('si canceló en la llamada → sale', API.bienvenidaCerrada(B));

  t('la 2ª llamada se propone en día laborable: viernes → lunes',
    API.diaSiguienteHabil('2026-11-20') === '2026-11-23' && API.diaSiguienteHabil('2026-11-16') === '2026-11-17');

  const COD = ['bienvenida_bien', 'bienvenida_dudas', 'bienvenida_no_sabia', 'bienvenida_salvada', 'bienvenida_no_contesta'];
  t('los códigos de bienvenida existen y son del día (`term`)',
    COD.every(k => API.CATALOGO[k] && API.TERMINAL.has(k)));
  t('NO cierran ni esperan: un cierre taparía una baja futura de la misma clienta',
    COD.every(k => !API.CIERRA.has(k) && !API.ESPERA.has(k)));
  t('caben en la columna `resultado` (el worker corta a 40)', COD.every(k => k.length <= 40));
  t('la bienvenida no ofrece `intento_2` (dispararía el protocolo de 72 h) ni `retenida`',
    (() => { const i = SRC.indexOf("if(caso.tipo==='bienvenida'){"), j = SRC.indexOf("} else if(contacto==='no_localizada'){", i);
             const b = SRC.slice(i, j); return i > 0 && j > i && !/'intento_[12]'|'retenida'/.test(b) && /'bienvenida_no_contesta'/.test(b) && /'cancelacion'/.test(b); })());
  t('se registra con su propio tipo de caso',
    /caso\.tipo==='bienvenida'\?'bienvenida':\(caso\.tipo==='calidad'\?'calidad':\(caso\.tipo==='compra'\?'compra_unica':'baja'\)\)/.test(SRC));
  t('la sección se carga con `.catch`: si falla, la estación sigue en pie',
    /\/api\/dashboard\/bienvenidas'[^\n]*\.catch\(\(\)=>\(\{\}\)\)/.test(SRC));
  t('las bienvenidas no entran en LISTA (no hinchan «Todas» ni la barra del día)',
    (() => { const a = SRC.indexOf('LISTA=[\n'), b = SRC.indexOf('\n  ];', a);
             return a > 0 && b > a && !/bienvenida|BIENV/i.test(SRC.slice(a, b)); })()
    && /const bienv = dfil\(BIENV\)/.test(SRC) && !/todas:[^\n]*bienv\.length[^\n]*medicas:/.test(SRC));
  t('sin botones de reparto: es una lista compartida',
    API.botonesAsignacion({ bienvenida: true, contract_id: '1' }, 0) === '');
  // ── ⭐ Perfil rescatable (19/11/2026) ──
  t('rescate: clienta nueva primero', API.nivelRescate({ motivo: 'precio', antiguedad: '<1m' }) === 0);
  t('rescate: muro (menos de 2 pedidos) = nueva', API.nivelRescate({ motivo: 'gate_2pedidos' }) === 0);
  t('rescate: 2 productos primero aunque sea antigua', API.nivelRescate({ motivo: 'acumulo', antiguedad: '>6m', pedidos: 9, n_productos: 2 }) === 0);
  t('rescate: antigua con 1 producto = normal', API.nivelRescate({ motivo: 'puntual', antiguedad: '5-6m', pedidos: 6, n_productos: 1 }) === 1);
  t('rescate: salud, ya mejor o no noto nada → al final, aunque sea nueva',
    ['salud', 'incompatible', 'resuelto', 'resultados'].every(m => API.nivelRescate({ motivo: m, antiguedad: '<1m', n_productos: 3 }) === 2));
  t('rescate: la marca dice por qué', API.marcaRescate({ motivo: 'precio', antiguedad: '1-2m', n_productos: 2 }).includes('nueva, 2 productos') && API.marcaRescate({ motivo: 'salud' }) === '');
  t('rescate: el orden no toca las médicas ni la búsqueda', /if\(!busca && \(filtro==='baja'\|\|filtro==='derivada'\)\) VIS = \[0,1,2,undefined\]/.test(SRC));
  // ── 🔎 Calidad (19/11/2026) ──
  {
    const Q = { tipo: 'calidad', calidad: true, contract_id: '1', fecha: d(2) };
    conGestiones([]);
    t('calidad: sin llamar → sale en la lista', !API.calidadCerrada(Q));
    conGestiones([{ tipo_caso: 'calidad', resultado: 'calidad_envio', created_at: d(1) + ' 10:00', contract_id: '1' }]);
    t('calidad: hablaron → sale del cubo', API.calidadCerrada(Q));
    conGestiones([{ tipo_caso: 'calidad', resultado: 'calidad_no_contesta', created_at: d(1) + ' 10:00', contract_id: '1', proxima_llamada: d(0) }]);
    t('calidad: no contestó y la 2ª es hoy → vuelve', !API.calidadCerrada(Q));
    conGestiones([1, 2].map(k => ({ tipo_caso: 'calidad', resultado: 'calidad_no_contesta', created_at: d(k) + ' 10:00', contract_id: '1' })));
    t('calidad: dos sin respuesta → no se insiste', API.calidadCerrada(Q));
    conGestiones([{ tipo_caso: 'baja', resultado: 'retenida', created_at: d(1) + ' 10:00', contract_id: '1' }]);
    t('calidad: una gestión de OTRO tipo no la cierra', !API.calidadCerrada(Q));
    const CQ = Object.keys(API.CATALOGO).filter(k => k.startsWith('calidad_'));
    t('calidad: 7 códigos, ninguno cancela, cierra ni espera', CQ.length === 7 && CQ.every(k => !API.CATALOGO[k].cancela && !API.CIERRA.has(k) && !API.ESPERA.has(k) && API.TERMINAL.has(k) && k.length <= 40));
    t('calidad: el registro no ofrece Cancelación ni Pausa (ya está de baja)',
      (() => { const i = SRC.indexOf("} else if(caso.tipo==='calidad'){"), j = SRC.indexOf("} else if(contacto==='no_localizada'){", i);
               const b = SRC.slice(i, j); return i > 0 && j > i && !/'cancelacion'|'pausa'|'compra_unica/.test(b) && /'calidad_no_contesta'/.test(b); })());
    t('calidad: la nota es obligatoria si hablaron', /caso\.tipo==='calidad' && contacto==='localizada' && resultado!=='calidad_no_quiere' && nota\.length<5/.test(SRC));
    conGestiones([{ tipo_caso: 'calidad', resultado: 'calidad_no_contesta', created_at: d(1) + ' 10:00', email: 'a@t.com', contract_id: '1' }]);
    t('calidad: ya llamada sigue siendo de calidad al re-registrar', API.gestionadasCards()[0].tipo === 'calidad');
    t('calidad: sin botones de reparto', API.botonesAsignacion({ calidad: true, contract_id: '1' }, 0) === '');
    t('calidad: se carga con `.catch`', /\/api\/dashboard\/calidad'[^\n]*\.catch\(\(\)=>\(\{\}\)\)/.test(SRC));
  }
  conGestiones([{ ...NC, created_at: d(1) + ' 10:00', proxima_llamada: d(0) }]);
  t('su 2ª llamada NO se cuela en «Agendadas» (va por dueña): la tarjeta va marcada',
    API.gestionadasCards().every(c => c.esBienvenida) && /c\.prox && !c\.esBienvenida/.test(SRC));

  const W = fs.readFileSync(path.join(RAIZ, '..', 'flujo-bajas', 'worker', 'src', 'index.js'), 'utf8');
  t('worker: `bienvenida` es un tipo de caso propio (ni baja ni fallo de pago)',
    /b\.tipo_caso === "bienvenida" \? "bienvenida" : \(b\.tipo_caso === "calidad" \? "calidad" : \(b\.tipo_caso === "compra_unica" \? "compra_unica" : "baja"\)\)/.test(W));
  t('worker: el email de 72 h sigue atado SOLO a fallo_pago',
    /tipo === "fallo_pago" && resultado === "intento_2"/.test(W));
  t('worker: la entrega sale de `deliveredAt`, no de «enviado»',
    /f\.deliveredAt/.test(W) && !/entregado_at[^\n]*displayStatus === "FULFILLED"/.test(W));
  t('worker: la ruta exige credenciales y el refresco a mano es solo de admin',
    /pathname === "\/api\/dashboard\/bienvenidas"[\s\S]{0,300}?verView\(me\)[\s\S]{0,300}?me\.role !== "admin"\) delete b\.refrescar/.test(W));
  t('worker: el grupo sin llamar NO llega a la lista de Carme',
    /r\.grupo !== "control"/.test(W));
  t('worker y front usan las mismas etiquetas',
    ['bienvenida_bien', 'bienvenida_dudas', 'bienvenida_no_sabia', 'bienvenida_salvada'].every(k => W.includes('"' + k + '"')));
  // Funciones puras del worker, ejecutadas de verdad.
  const trozo = (desde, hasta) => W.slice(W.indexOf(desde), W.indexOf(hasta));
  const pedidoDelAlta = new Function(trozo('function pedidoDelAlta', 'async function refrescarBienvenidas') + '; return pedidoDelAlta;')();
  const alta = '2026-11-10T10:00:00Z';
  t('casa el pedido creado con el alta',
    pedidoDelAlta([{ name: '#2', createdAt: '2026-11-10T10:00:05Z' }, { name: '#1', createdAt: '2026-09-01T10:00:00Z' }], alta).name === '#2');
  t('un pedido de hace meses NO vale como «el del alta»',
    pedidoDelAlta([{ name: '#1', createdAt: '2026-09-01T10:00:00Z' }], alta) === null);
  t('un pedido cancelado no cuenta',
    pedidoDelAlta([{ name: '#2', createdAt: '2026-11-10T10:00:05Z', cancelledAt: '2026-11-10T12:00:00Z' }], alta) === null);
  const grupo = new Function(trozo('const BIENVENIDA_CONTROL_DE_CADA', '/** Desde qué día de ENTREGA') + '; return grupoBienvenida;')();
  const ids = Array.from({ length: 4000 }, (_, i) => String(23000000000000 + i * 7919));
  const nCtl = ids.filter(x => grupo(x) === 'control').length;
  t(`el grupo sin llamar es ~1 de cada 4 (${nCtl} de 4000)`, nCtl > 880 && nCtl < 1120);
  t('y es estable: la misma clienta cae siempre en el mismo grupo', ids.slice(0, 50).every(x => grupo(x) === grupo(x)));
}

// ── Navegación en dos pestañas (16/11/2026) ───────────────────────────
bloque('PESTAÑAS — nuevas clientas y fallos de pago; las bajas no se pierden');
{
  const S = (SRC.match(/const SECCIONES=\{[\s\S]*?\n\};/) || [''])[0];
  t('hay cuatro secciones: bienvenida, fallo, compra y otros', /bienvenida:\{/.test(S) && /fallo:\{/.test(S) && /otros:\{/.test(S) && /compra:\{/.test(S));
  t('las cancelaciones NO están en las dos pestañas de trabajo',
    (() => { const f = (S.match(/fallo:\{[^\n]*/) || [''])[0], w = (S.match(/bienvenida:\{[^\n]*/) || [''])[0];
             return !/'baja'|'derivada'|'cancelada'|'senal'|'medicas'/.test(f + w); })());
  t('…pero siguen a un clic: médicas, derivadas, bajas y alertas viven en «Quieren irse»; canceladas, en el historial',
    (() => { const o = (S.match(/otros:\{[^\n]*/) || [''])[0];
             return o.includes("'irse'") && o.includes("'calidad'") && o.includes("'agendadas'")
               && /const irse = \[\.\.\.vivas\.filter\(x=>x\.tipo==='baja'\|\|x\.tipo==='derivada'\), \.\.\.senales\]/.test(SRC)
               && /const HISTORIAL=\[[^\n]*'cancelada'[^\n]*'pausasfut'|const HISTORIAL=\[[^\n]*'pausasfut'[^\n]*'cancelada'/.test(SRC); })());
  t('la prioridad se ve en la tarjeta (etiqueta grande), no solo en el texto pequeño',
    /<div class="ctr">\$\{prioridad\(c\)\}/.test(SRC) && /function prioridad\(c\)\{[\s\S]{0,400}c\.medico\) return p\('red'/.test(SRC));
  t('en «Quieren irse» las médicas van SIEMPRE primero (plazo de 72 h)',
    /const med = VIS\.filter\(c=>c\.medico\)[^\n]*\n\s*VIS = \[\.\.\.med, \.\.\.VIS\.filter/.test(SRC));
  t('«Bajas por cerrar» sólo se pinta si queda algún caso vivo',
    /filter\(k=>k!=='otros'\|\|nSec\.otros\|\|seccion==='otros'\)/.test(SRC));
  t('las médicas cuentan para que la pestaña no desaparezca con una dentro',
    /otros: medicas\.length \+/.test(SRC));
  t('Carme entra a bienvenidas y el resto a fallos de pago',
    /me\.email==='ayuda@wearedomma\.com' \? 'bienvenida' : 'fallo'/.test(SRC));
  t('la barra del día es la de la pestaña, no la de toda la estación',
    /const pendientes = seccion==='compra' \? compras\.length : seccion==='bienvenida' \? bienv\.length : vivasSec\.length\+agS\.length\+porRegSec\.length/.test(SRC));
  t('el buscador sigue mirando TODO (no hereda la pestaña)',
    /const vivasB=\[\.\.\.LISTA, \.\.\.BIENV\.filter\(c=>!bienvenidaCerrada\(c\)\), \.\.\.CALID, \.\.\.COMPRA\]/.test(SRC)
    && /for\(const c of \[\.\.\.vivasB, \.\.\.gestionadasCards\(\), \.\.\.REGISTRO\]\)/.test(SRC));
  // 24/11/2026 · caso Olga: buscando a una clienta nueva salía solo su historial de fallo.
  t('el buscador incluye bienvenidas y calidad', /\.\.\.BIENV\.filter/.test(SRC) && /\.\.\.CALID, \.\.\.COMPRA\]/.test(SRC));
  t('si la clienta tiene tarjeta viva, su historial no sale en la búsqueda', /if\(c\.gestionada && quien\(c\)\.some\(x=>conViva\.has\(x\)\)\) continue;/.test(SRC));
}

// 24/11/2026 · Decisión de Cristina tras el feedback de Carme: tres cambios, fuente real.
bloque('LUNA, CALIDAD Y COMPRA ÚNICA');
{
  t('LUNA: todas las alertas van tras médicas y antes de ⭐',
    ['no_puede_darse_de_baja','efectos_secundarios','no_le_funciona','otra'].every(m=>API.nivelIrse({tipo:'senal',motivo:m})===1)
    && API.nivelIrse({medico:true,tipo:'senal'})===0 && API.nivelIrse({rescate:0})===2
    && API.nivelIrse({rescate:1})===3 && API.nivelIrse({rescate:2})===4);
  const alertas=[{motivo:'otra',fecha:'2026-11-15'}, {motivo:'otra',ultima_senal:'2026-11-10'},
    {motivo:'efectos_secundarios',fecha:'2026-11-20'}, {motivo:'no_puede_darse_de_baja',fecha:'2026-11-21'}];
  t('LUNA: bloqueo y efectos primero, el resto de más antigua a más nueva',
    alertas.sort(API.compararSenales).map(c=>c.ultima_senal||c.fecha).join() === '2026-11-20,2026-11-21,2026-11-10,2026-11-15');
  t('LUNA: chip rojo con guion claro', API.prioridad({tipo:'senal',motivo:'otra'}).includes('🔴 Alerta de LUNA · llamar hoy')
    && API.prioridad({tipo:'senal'}).includes('La clienta le dijo a LUNA que se quiere ir. Es la llamada que más se rescata'));
  t('LUNA: conserva el chip de no poder darse de baja', API.prioridad({tipo:'senal',motivo:'no_puede_darse_de_baja'}).includes('🔴 Urgente · no puede darse de baja'));
  t('calidad: chip y subtítulo dicen fallo nuestro', SRC.includes('🔎 Fallo nuestro (calidad)') && SRC.includes('Bajas y calidad por fallo nuestro'));
  t('compra: sección entre fallos y bajas, con sus dos listas', SRC.includes("['bienvenida','fallo','compra','otros']")
    && SRC.includes("compra:{def:'compra', chips:[['compra','Por llamar'],['compra_hechas','Ya llamadas']]}")
    && SRC.includes("compra:['🛒 Compra única','Pasar a suscripción']"));
  const codes=['compra_unica_suscrita','compra_unica_interesada','compra_unica_no_quiere'];
  t('compra: tres resultados finales y sin acciones sobre la suscripción', codes.every(k=>API.TERMINAL.has(k)&&!API.CIERRA.has(k)&&!API.ESPERA.has(k)&&!API.CATALOGO[k].cancela));
  t('compra: no contesta no es terminal', API.CATALOGO.compra_unica_no_contesta.tone==='amber'&&!API.TERMINAL.has('compra_unica_no_contesta'));
  t('compra: suscrita celebra y las etiquetas son claras', API.CATALOGO.compra_unica_suscrita.win==='🛒 Suscrita'
    && API.CATALOGO.compra_unica_interesada.b==='Le interesa: enviar enlace' && API.CATALOGO.compra_unica_no_quiere.tone==='gray');
  t('compra: el endpoint tiene catch para no romper la estación', /compra-unica'[^\n]*\.catch\(\(\)=>\(\{\}\)\)/.test(SRC));
  t('compra: solo sus resultados, sin cancelación ni pausa', (()=>{
    const bloque=SRC.slice(SRC.indexOf("if(caso.tipo==='compra'){"),SRC.indexOf("} else if(caso.tipo==='bienvenida'){"));
    return [...codes,'compra_unica_no_contesta'].every(k=>bloque.includes(k))&&!/cancelacion|pausa|intento_2/.test(bloque);
  })());
  t('compra: guardar envía compra_unica', SRC.includes("caso.tipo==='compra'?'compra_unica':'baja'"));
  t('compra: nota obligatoria si hablaron', SRC.includes("caso.tipo==='compra' && contacto==='localizada' && nota.length<5"));
  conGestiones([{tipo_caso:'compra_unica',customer_id:'9',contract_id:'',resultado:'compra_unica_interesada',created_at:d(1)}]);
  t('compra: el historial conserva tipo y marca', API.gestionadasCards()[0].tipo==='compra'&&API.gestionadasCards()[0].esCompra);
  t('compra: sin asignación ni prioridad incluso desde historial', API.botonesAsignacion({tipo:'compra',contract_id:'1'},0)===''
    && API.prioridad({tipo:'compra'})==='' && API.prioridad({esCompra:true})==='');
  t('compra: hablaron → fuera', API.compraCerrada({customer_id:'9'}));
  conGestiones([{tipo_caso:'compra_unica',customer_id:'9',contract_id:'',resultado:'compra_unica_no_contesta',created_at:d(1)}]);
  t('compra: un intento de ayer vuelve', !API.compraCerrada({customer_id:'9'}));
  conGestiones([1,2].map(k=>({tipo_caso:'compra_unica',customer_id:'9',contract_id:'',resultado:'compra_unica_no_contesta',created_at:d(k)})));
  t('compra: dos intentos salen de la lista', API.compraCerrada({customer_id:'9'}));
  t('compra: ficha cuenta producto, entrega, primera compra y guion', (()=>{
    const ficha=API.fichaCompra({productos:['Deseo <x>'],entregado:'2026-11-10',primera_compra:true});
    return ficha.includes('Deseo &lt;x&gt;')&&ficha.includes('Primera compra')&&ficha.includes('Llamada de seguimiento: pregúntale')&&ficha.includes('No insistas si no le interesa.');
  })());
}

// ── 8. Humo contra producción (opcional) ──────────────────────────────
if (PROD) {
  bloque('PRODUCCIÓN — endpoints y páginas vivas');
  const API_BAJAS = 'https://manage.wearedomma.com';
  // 90s, no 30: /today recorre los ~650 intentos de cobro de Appstle y tarda entre 14s y 47s
  // medidos el 29/09. Con 30s el humo cantaba «/today no responde» estando perfectamente vivo,
  // y un test que da falsas alarmas acaba ignorándose entero.
  const pedir = async (u, o) => { try { return await fetch(u, { signal: AbortSignal.timeout(90000), ...o }); }
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

// 24/11/2026 — Render real de tarjetas LUNA; solo se aíslan los adornos ajenos al caso.
{
  const tarjeta = new Function('prioridad', `
    ${linea('const esc=')}
    const histDe=()=>[], avisoContrato=()=>'', relojMedico=()=>'', diasEspera=()=>0;
    const puntosContactos=()=>'', insigniaDueno=()=>'', histInner=()=>'', botonesAsignacion=()=>'';
    ${extraer('function tarjeta(')}
    return tarjeta;
  `)(API.prioridad);
  const potencial = {tipo:'senal', sin_compra:true, nombre_whatsapp:'☂️ Hanna'};
  const html = tarjeta(potencial,0);
  t('LUNA potencial: chip y nombre WhatsApp sin alerta de baja ni nombre vacío',
    html.includes('🌱 Potencial · sin compra') && html.includes('☂️ Hanna')
    && html.includes('(nombre de WhatsApp)') && !html.includes('Alerta de baja') && !html.includes('Sin nombre'));
  t('LUNA potencial: prioridad explica que no ha comprado',
    html.includes('🌱 Potencial · no ha comprado')
    && html.includes('Escribió a LUNA pero no tiene compra ni cuenta en Shopify con este teléfono')
    && !html.includes('La clienta le dijo a LUNA que se quiere ir'));
  t('LUNA potencial: escapa el nombre de WhatsApp',
    tarjeta({...potencial,nombre_whatsapp:'<b>Hanna</b>'},0).includes('&lt;b&gt;Hanna&lt;/b&gt;'));
  t('LUNA normal: conserva Alerta de baja', tarjeta({tipo:'senal',nombre:'Clienta'},0).includes('🔔 Alerta de baja'));
  t('LUNA potencial atascada: conserva prioridad urgente',
    API.prioridad({...potencial,motivo:'no_puede_darse_de_baja'}).includes('🔴 Urgente · no puede darse de baja'));
  t('LUNA: el mapeo conserva los campos de potencial',
    SRC.includes('sin_compra:s.sin_compra, nombre_whatsapp:s.nombre_whatsapp'));
}

// 24/11/2026 · caso Olga: se evalúan los helpers y el guardado reales, sin red.
{
  const {destinoGestion, avisoContrato}=new Function(`${linea('const esc=')}\n${extraer('function destinoGestion(')}\n${extraer('function avisoContrato(')}\nreturn {destinoGestion,avisoContrato};`)();
  const activo={contract_id:'146043732347',customer_id:'24938926932347',productos:['Deseo','<Equilibrio>']};
  const caso={contract_id:'143861154171',customer_id:null,estado_contrato:'cancelled',contrato_activo:activo,tipo:'baja'};
  API.set({GALL:[{...caso,contacto:'localizada',resultado:'retenida',tipo_caso:'baja'}]});
  const card=API.gestionadasCards()[0];
  t('Olga: tarjeta conserva estado y contrato activo',card.estado_contrato==='cancelled'&&card.contrato_activo===activo);
  t('Olga: aviso escapa productos y los une',avisoContrato(caso).includes('Deseo + &lt;Equilibrio&gt;'));
  t('Olga: aviso visible en tarjeta y panel',SRC.includes('${avisoContrato(c)}')&&extraer('function reveal(').includes('${avisoContrato(VIS[i])}'));
  t('contrato vigente mantiene su destino',destinoGestion({...caso,estado_contrato:'active'}).contract_id===caso.contract_id);
  const guardarReal=extraer('async function guardar(');
  async function guardarCaso(c, resultado='cancelacion', nota=''){
    let body, confirms=[];
    const nodes={d0:{dataset:{contacto:'localizada',sel:resultado}},msg0:{style:{}},nota0:{value:nota},prox0:{value:''}};
    const document={getElementById:id=>nodes[id]||null,querySelectorAll:()=>[]};
    // La respuesta termina por sesión caducada justo después de capturar el POST.
    const fn=new Function('VIS','document','destinoGestion','fetch','confirm',`
      const CANCELA_APPSTLE=new Set(['cancelacion']); const RES_LABEL={};
      const API_BAJAS='offline', token='', agActual=()=> 'QA';
      const sesionCaducada=()=>true, avisarSesion=()=>{};
      ${guardarReal}; return guardar(0);`);
    await fn([c],document,destinoGestion,async(url,opts)=>{body=JSON.parse(opts.body);return {json:async()=>({ok:true})};},msg=>{confirms.push(msg);return true;});
    return {body,confirms};
  }
  const viva=await guardarCaso(caso);
  t('Olga: POST usa contract_id y customer_id activos',viva.body.contract_id===activo.contract_id&&viva.body.customer_id===activo.customer_id&&!viva.body.solo_registro);
  t('Olga: cancelar la activa sigue pidiendo confirmación',viva.confirms.length===1&&viva.confirms[0].includes('CANCELA AHORA'));
  const compra=await guardarCaso({tipo:'compra',customer_id:'9',contract_id:''},'compra_unica_interesada','Le va bien, enviar enlace');
  t('compra: POST real guarda tipo, clienta y contrato vacío',compra.body.tipo_caso==='compra_unica'&&compra.body.customer_id==='9'&&compra.body.contract_id==='');
  t('compra: registrar no pide confirmar acciones en Appstle',compra.confirms.length===0);
  const sinNota=await guardarCaso({tipo:'compra',customer_id:'9'},'compra_unica_interesada');
  t('compra: guardar real impide POST sin nota',sinNota.body===undefined);
  const sinActiva=await guardarCaso({...caso,contrato_activo:null});
  t('cancelada sin activa: POST solo_registro',sinActiva.body.solo_registro===true&&sinActiva.body.contract_id===caso.contract_id);
  t('cancelada sin activa: no pide confirmar cancelación',sinActiva.confirms.length===0);
  t('cancelada sin activa: aviso explica solo registro',avisoContrato({...caso,contrato_activo:null}).includes('solo se apunta la llamada, no se toca Appstle'));
}

// ── Resultado ─────────────────────────────────────────────────────────
console.log(`\n${ok} OK · ${ko} KO${PROD ? '' : '   (añade --prod para el humo contra producción)'}`);
process.exit(ko ? 1 : 0);
