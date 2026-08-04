# Estación «A quién llamo» — documentación y registro de cambios

`data.wearedomma.com/llamadas/` · CRM de llamadas para el equipo de retención (Carme + Vale).
Repo `CrisDOMMA/domma-data-dashboard` → auto-deploy a Cloudflare Pages (`domma-data-hub`).
El backend es el worker `domma-bajas` (repo `flujo-bajas`, `worker/src/index.js`).

---

## Qué es

Lista priorizada de a quién llamar y herramienta para registrar la gestión. Tres tipos de caso:

- **Bajas** — solicitudes de baja que gestiona el equipo (no se auto-cancelan).
- **Derivadas** — clientas que pasan a acompañamiento con Ana.
- **Fallos de pago** — suscripciones activas con cobro rechazado (fuente: Appstle).

Cada tarjeta muestra nombre, email, teléfono, **antigüedad** (`⏳ N días esperando`, más antiguas primero por defecto) y las acciones: **Llamar** (Ringover click-to-call), **WhatsApp** (abre el chat en WATI) y **Registrar gestión**.

---

## Estados y filtros

Chips de filtro: **Todas · Bajas · Derivadas · Fallos de pago · Contactadas · No contactadas · Pagos por validar**.

| Estado en la tarjeta | Qué significa | Color |
|---|---|---|
| *(sin chip)* | Pendiente de llamar | ámbar |
| **Contactada** | Localizada, gestión registrada | verde |
| **No contactada** | Se intentó, no se localizó | ámbar |
| **Retenida · pausa** | Fallo/baja salvada con pausa → cuenta como retenida y pasa a **Derivadas** con fecha de recontacto | verde |
| **Cobro hecho · validar** | Carme marcó el cobro; pendiente de que Cristina lo valide | ámbar |
| **Pagado ✓** | Cobro validado por Cristina | verde |
| **Ha pagado** | El fallo ya no consta en Appstle (se resolvió solo) | verde |

**Motivador** (arriba, por agente y por día): 💚 retenidas · 🚀 ventas cruzadas · ⬆️ upsells · 💰 cobros. Una **pausa** suma como retenida. Los logros lanzan confeti.

---

## Flujos clave

### Cobro en 2 pasos (fallos de pago)
1. Carme llama y marca **💳 Cobro hecho** → estado «Cobro hecho · validar» (queda en el filtro *Pagos por validar*).
2. Cristina revisa y pulsa **✓ Marcar pagado** → estado «Pagado ✓» (cuenta como cobro; ya no se re-celebra).

### Pausa = retención con seguimiento
Cuando un fallo o baja se salva con **⏸️ Pausa** (p. ej. cancelación encubierta): cuenta como **retenida** (motivador + confeti), sale de *Contactadas* y aparece en **Derivadas** con chip «Retenida · pausa» y la **próxima llamada** (fin de pausa) para recontactar.

### Editar / próxima llamada
Toda gestión se puede reabrir y editar (`abrirEdit`). En cualquier estado se puede fijar **próxima llamada** (`proxima_llamada`), que se muestra como `📅 próx. …`.

---

## Registro de cambios (sesión 03–04/08/2026)

| Commit | Cambio |
|---|---|
| `544009e` | Bajas: quitar `margin-top` que arrancaba 18px más abajo que el resto de pestañas |
| `d5209fc` | Worklist persistente de fallos — un caso no desaparece antes de registrar la gestión (bug #1) |
| `e551cf9` | Buscador de clientas (nombre/email/teléfono) |
| `5061c2a` | Botón **Llamar** por Ringover click-to-call (en vez de `tel:`) |
| `d09e476` | Filtro «Ya habladas» + la búsqueda encuentra clientas ya gestionadas |
| `b8de181` | «Ya habladas» → **Contactadas** |
| `0bd3458` | «Pausa» en el desglose de No localizada (fallos y bajas/derivadas) |
| `0763864` | Editar/añadir gestiones · **próxima llamada** en todos los estados · filtro **No contactadas** · **Pagado** con logro + confeti |
| `98e741e` | Ordenar por **antigüedad** (más antiguas primero) + toggle |
| `77cd697` | Mostrar **días de espera** en cada tarjeta |
| `f3fecec` | **Pausa** en fallos localizada · botones a 2 columnas + más pequeños · cerrar `✕` compacto · chip «Cobrada» distinto de «Contactada» |
| `160472a` | Quitar icono inventado de No contactadas + **flujo cobro 2 pasos** (cobro hecho → validar) |
| `d46e2f4` | Filtro **«Pagos por validar»** |
| `ab1c087` | «Ya pagó» → **«Ha pagado»** |
| `62a2c36` | **Pausa = retención**: cuenta como retenida + confeti y aparece en **Derivadas** con fecha de recontacto |

### Backend (worker `domma-bajas`, repo `flujo-bajas`)
| Commit | Cambio |
|---|---|
| `4ecb7ef` | **Enlaces**: WATI deep-link con `?filter=` (abre el chat directo) + Ringover `device: "ALL"` (suena en todos los dispositivos) |

Además, sin commit nuevo (ya existían de sesiones previas): endpoints `gestion` (acepta `proxima_llamada`, devuelve la fila con `RETURNING *`), `gestion-editar`, `fallos-sync` (worklist), `ringover-call`, `wati-link`.

---

## Notas técnicas

- **WATI**: el deep-link necesita host `live-11263.wati.io` + `?filter={"channelType":0,"filterType":5,"filterId":5}`; el id de contacto se resuelve por teléfono (`getContacts?name=<tel>`, ObjectId de Mongo).
- **Ringover**: `POST /v2/callback`, header `Authorization: <key>` (sin «Bearer»); `to_number` obligatorio; `device:"ALL"` para que suene en todos. La key necesita permisos Monitoring + Calls/Contacts/Numbers R/W. Requiere que el agente tenga su Ringover online.
- **contract_id**: se guarda con sufijo float `".0"` en `baja_eventos`; `normId` lo limpia antes de comparar/join.
- Cloudflare Pages sirve el índice en `/llamadas/` (con barra final). `/llamadas/index.html` directo devuelve vacío (trampa al verificar en vivo).
