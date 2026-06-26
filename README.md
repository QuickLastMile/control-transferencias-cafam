# Control de Transferencias · Quick para Cafam

Prototipo de un **sistema digital de control y conciliación** para reemplazar el
formato en papel con el que hoy se legalizan las transferencias punto a punto de Cafam.

El objetivo es cerrar el fraude del modelo actual (sello físico reutilizable + datos
escritos a mano) anclando cada legalización al **número de guía real de la plataforma**
y respaldándola con evidencia no falsificable.

## Qué hace la demo

App web estática, mobile-first, con tres vistas:

- **📦 Mensajero** — legaliza una transferencia. Valida la guía contra la plataforma,
  captura GPS, foto de evidencia, hora automática y el PIN del punto (reemplaza al sello).
- **📊 Tablero** — conciliación en tiempo real: montadas vs legalizadas, con KPIs y
  alertas (conciliada / pendiente / alerta por guía fantasma).
- **⚙️ Datos** — carga la lista de guías montadas de la plataforma (CSV o pegar texto),
  muestra los puntos con su PIN y permite volver a los datos demo.

### El principio de anclaje
Si el número de guía **no existe en la plataforma**, la app **no permite legalizar**.
Así, lo legalizado y lo montado cuadran por construcción.

## Cómo probarla

1. Abre `index.html` en el navegador (o el sitio publicado).
2. En **Mensajero**, escribe una guía válida (ej. `4954425`) y pulsa *Validar*.
   - Prueba también una guía falsa (ej. `9999999`) para ver el bloqueo.
3. Captura GPS, toma una foto e ingresa el PIN del punto (ver pestaña *Datos demo*).
4. Pulsa *Legalizar* y revisa el **Tablero**.

> Los PIN de la demo coinciden con el código CC del punto (ej. Viva 51B → `2810`).

## Tecnología

HTML + CSS + JavaScript puro, sin dependencias ni backend. Los datos se guardan en
`localStorage`. Pensado para publicarse en **GitHub Pages**.

## Sin API: cómo se obtiene la "fuente de verdad"

La plataforma de Cafam **no tiene API y no se puede obtener**. No hace falta: el sistema
solo necesita, por periodo, la **lista de guías montadas**. En la vista *Datos* se carga
esa lista mediante:

1. **Archivo CSV/Excel** exportado de la plataforma, o
2. **Pegar** la lista copiada de la pantalla de la plataforma.

Formato aceptado por línea: `guía, origen, destino` (origen y destino opcionales; el
parser detecta encabezados y mapea el destino contra los puntos conocidos). Esa carga
reemplaza la revisión manual del papel.

## De prototipo a producción

Esta demo guarda todo en `localStorage`. En producción:

- La lista de guías montadas se sigue cargando por **export/pegado** (no requiere API).
- Las legalizaciones se guardan en un **backend** (p. ej. Google Sheets vía Apps Script,
  como las otras apps de Quick) en lugar de `localStorage`.
- La **hora** se sella en el servidor y el **GPS** se valida contra la geocerca real.
- La confirmación del punto puede evolucionar de PIN a **QR dinámico** u OTP.

## Estructura

```
control-transferencias-cafam/
├── index.html
├── assets/
│   ├── styles.css
│   ├── seed.js     # datos demo (puntos, PIN, guías montadas)
│   └── app.js      # lógica: validación, captura, conciliación
└── README.md
```

---
Prototipo interno de Quick. Datos de ejemplo basados en el Formato Control Transferencias.
