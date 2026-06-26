# Backend en Google Apps Script — Guía de despliegue

Este backend conecta la app con tu Google Sheets. Son **dos despliegues del mismo
script**: la *API del mensajero* (abierta, con token) y el *Panel del Regente*
(con login de Google).

## 1. Crear el proyecto de Apps Script

1. Abre tu Google Sheets → menú **Extensiones → Apps Script**.
2. Borra el contenido de `Código.gs` y pega todo el contenido de **`Code.gs`**.
3. Crea un archivo HTML: botón **+ → HTML**, nómbralo **`Regente`** (sin `.html`)
   y pega el contenido de **`Regente.html`**.

## 2. Configurar (bloque CONFIG en Code.gs)

Ajusta estos valores arriba en `Code.gs`:

- `HOJA_COLAB`: el **nombre exacto de la pestaña de nómina** (la de las cédulas).
  > Importante: revisa el nombre real de esa pestaña y ponlo aquí.
- `TOKEN`: cámbialo por una cadena larga y aleatoria propia.
- `REGENTES`: lista de **correos Google** que podrán aprobar/rechazar.
- (Opcional) `CARPETA_FOTOS_ID`: déjalo vacío y se crea una carpeta sola.

La hoja **`montadas`** (para el cruce con Smart Quick): crea una pestaña con ese
nombre y pega ahí los números de guía del export de la plataforma (una columna basta).
Si no existe, el cruce queda como "—" (no bloquea nada).

## 3. Autorizar permisos

1. En el editor, selecciona la función **`inicializar`** y pulsa **Ejecutar**.
2. Acepta los permisos (acceso a Sheets y Drive). Esto crea las hojas
   `registro` y `bitacora` y la carpeta de fotos.

## 4. Desplegar la API del mensajero

1. **Implementar → Nueva implementación → Tipo: Aplicación web**.
2. *Ejecutar como*: **Yo**. *Quién tiene acceso*: **Cualquiera**.
3. Implementar y **copiar la URL** (termina en `/exec`).
   → Esta URL va en la app (config `API_URL`).

## 5. Desplegar el Panel del Regente

1. **Implementar → Nueva implementación → Aplicación web** (otra implementación).
2. *Ejecutar como*: **Yo**. *Quién tiene acceso*: **Cualquiera con cuenta de Google**.
3. Implementar y copiar esa URL. Ábrela con `?view=regente` al final:
   `https://script.google.com/.../exec?view=regente`
   → Ese es el enlace que le pasas al regente. Al entrar inicia sesión con Google
   y solo los correos de `REGENTES` pueden aprobar.

> Cada vez que cambies el código, usa **Implementar → Gestionar implementaciones →
> editar (lápiz) → Versión: Nueva** para publicar los cambios en la MISMA URL.

## 6. Probar

- API activa: abre en el navegador `TU_API_URL?action=ping` → debe responder
  `{"ok":true,...}`.
- Panel: abre `TU_PANEL_URL?view=regente` → debe mostrar tu sesión y los pendientes.

## Hojas que maneja

| Hoja | Uso | ¿Se crea sola? |
|------|-----|----------------|
| (nómina) | Lee cédula → nombre + centro. **Solo** esos campos salen. | No (ya existe) |
| `DROGUERIA` | Puntos de venta (NOMBRE CORTO + FARMACIA PLATAFORMA). | No (ya existe) |
| `montadas` | Export de Smart Quick para el cruce de guías. | No (la creas tú) |
| `registro` | Cada legalización. La única que escribe la app. | Sí |
| `bitacora` | Log append-only de cada acción (crear/aprobar/rechazar). | Sí |

## Seguridad / notas

- El `TOKEN` viaja en el JavaScript del frontend (es visible). Es una barrera básica;
  la validación real es que la **cédula exista** en la base. No expongas datos
  sensibles: el backend solo devuelve **nombre y centro**, nunca salario/correo.
- La **hora** la sella el servidor (Apps Script), no el celular del mensajero.
- Una vez un registro queda Aprobado/Rechazado, el backend **impide** cambiarlo
  (inmutabilidad). Toda acción queda en `bitacora`.
