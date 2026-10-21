# Probar el prototipo (Etapa 1)

Esto solo se puede probar en tu Mac, dentro de Premiere Pro real — no hay
forma de simularlo en CI ni en este entorno de Claude. Son dos partes:
instalar el efecto compilado (si todavia no lo has hecho) y cargar el panel.

## 0. Requisitos

- Premiere Pro **25.6 o posterior** (tienes 26.5.2 — cumple).
- Creative Cloud desktop app, con sesión iniciada.

## 1. Instalar el efecto compilado (`ae/`)

El panel no sirve de nada si el efecto no está instalado como plugin de
video en Premiere. Por ahora no hay instalador (eso es de una etapa
posterior), así que es manual:

1. En GitHub, entra a **Actions** → el run más reciente de
   `Build Premiere plugin (macOS)` en la rama `premiere-stage0` del repo
   `ColorLab-3`.
2. Si el artefacto `ColorLab-Premiere-macOS` está disponible, descárgalo
   (contiene `ColorLab.plugin` y `ColorLabDemo.plugin`). Si no — la última
   corrida falló al subirlo por cuota de almacenamiento de Actions, aunque
   la compilación en sí fue exitosa — dímelo y recompilamos localmente o
   liberamos cuota primero.
3. Copia `ColorLab.plugin` (la edición full) a:
   `/Library/Application Support/Adobe/Common/Plug-ins/7.0/MediaCore/`
4. Reinicia Premiere si estaba abierto.

## 2. Activar el modo desarrollador y la UXP Developer Tool (UDT)

1. Abre **Creative Cloud** → pestaña **All apps** → busca **"UXP Developer
   Tools"** → **Install**.
2. Abre UDT. La primera vez te pedirá activar el modo desarrollador — pulsa
   **Enable** y acepta los permisos elevados (pide contraseña de admin).

## 3. Cargar el panel

1. En UDT, agrega este plugin usando el archivo
   `panel/manifest.json` de este repositorio (opción preferida: apuntar
   directo al `manifest.json`, no a un `.zip`).
2. Abre Premiere Pro con un proyecto cualquiera.
3. En UDT, sobre el plugin **"Color Lab (prototipo)"**, pulsa **Load & Watch**
   (recomendado — recarga sola si edito el código; si cambio
   `manifest.json` hay que **Unload** y volver a cargar).
4. Busca la notificación en la parte inferior de UDT: verde = cargó bien;
   roja con **Details** = error, ábrelo y pégame el log.
5. El panel "Color Lab (prototipo)" debería aparecer como panel acoplable
   en Premiere (**Window → Extensions**, o ya visible si UDT lo abrió).

## 4. Qué verificar (las 6 preguntas del informe, en orden)

Anota el resultado de cada una — eso decide si seguimos a la Etapa 2 o si
hay que replantear el diseño.

1. **Pulsa "1. Diagnosticar"** sin nada seleccionado. En el log del panel
   debe aparecer la lista de `matchNames` y cuál de ellos contiene
   `colorlab`. **Anota el matchName exacto que reporta** — lo necesito para
   el código si no es el que asumí.
2. **Selecciona un clip de video** en la línea de tiempo y pulsa
   **"2. Aplicar al clip seleccionado"**. Revisa **Controles de efectos**:
   ¿aparece "Color Lab" en la lista de efectos del clip?
3. Con el efecto ya aplicado, cambia **Look** e **Intensity** en el panel y
   vuelve a pulsar Aplicar (o ajusta los controles del propio efecto en
   Controles de efectos). ¿Cambia la imagen en el monitor de Programa?
   Pulsa **Cmd+Z**: ¿se deshace el cambio?
4. Prueba los casos límite: sin proyecto abierto, sin secuencia activa, sin
   nada seleccionado, y con un clip de **audio** seleccionado. El panel no
   debería trabarse — debe mostrar un aviso claro en el log en cada caso.
5. **Comparación con Resolve**: aplica el mismo Look a la misma fuente en
   DaVinci Resolve (con el OFX original) y en Premiere con este prototipo.
   ¿El frame se ve igual? Si tienes forma de exportar un frame de cada lado,
   mejor — pero una comparación visual alcanza para esta etapa.
6. **Rendimiento con Bloom en 4K**: en Controles de efectos, activa Bloom
   (aunque el panel no lo controle todavía, el efecto ya lo trae) sobre una
   fuente 4K. Reproduce y nota si hay caída notable de fps, y si puedes,
   cronometra una exportación corta con y sin Bloom.

## 5. Resultado (probado en Premiere 26.5.2, 20 oct 2026)

Las 6 preguntas quedaron respondidas positivamente:

1. **matchName exacto**: `AE.JKColorLab` (demo: `AE.JKColorLabDemo`). Premiere
   le antepone el prefijo `AE.` al nombre que se le dio en `ae/ColorLabAE.cpp`.
2. **Insertar el efecto**: `createAppendComponentAction` funciona y el efecto
   aparece en Controles de efectos.
3. **Escribir Look/Intensity + deshacer**: funciona con `createSetValueAction`,
   y Cmd/Ctrl+Z deshace el cambio correctamente. Dos hallazgos importantes al
   implementarlo (ver notas abajo).
4. **Casos límite** (sin proyecto, sin secuencia, sin selección, clip de
   audio): el panel no se traba en ninguno, siempre da un aviso o error
   legible.
5. **Comparación con Resolve**: el mismo Look sobre la misma fuente se ve
   igual en Premiere que en el OFX de Resolve.
6. **Rendimiento con Bloom en 4K**: sin caída notable.

### Notas para la Etapa 2

- **El componente recién creado por `VideoFilterFactory.createComponent()`
  no expone `getParamCount()`/`getParam()` antes de insertarse en la
  cadena.** Hay que insertarlo primero (transacción 1), releerlo con
  `chain.getComponentAtIndex(indice)` y recién ahí leer/escribir parámetros
  (transacción 2). Intentar leer parámetros del componente "suelto" tira
  `TypeError: getParamCount is not a function`.
- **El popup "Look" es base-1 del lado de After Effects, pero Premiere lo
  interpreta como índice base-0 de la lista de choices.** Hay que restar 1
  al índice (1-based, como en `looks/looks.manifest`) antes de mandarlo con
  `createKeyframe()`.
- **UXP no aplica los valores iniciales declarados en el HTML**
  (`value="100"`, opción seleccionada por defecto de un `<select>`): hay que
  forzarlos por JS después de poblar los controles.
- **El `<input type="range">` nativo se trababa en 0 al arrastrarlo** en
  este runtime de UXP — se reemplazó por un campo numérico. Para la Etapa 2
  conviene un deslizador construido a mano (HTML/CSS propio), no el control
  nativo.
- **Un `AudioClipTrackItem` también expone `getComponentChain()`** — no
  alcanza con comprobar que el método exista para distinguir video de audio;
  el error real (`Invalid parameter`) sale recién al intentar insertar un
  filtro de video ahí.

Con esto, la arquitectura (panel UXP controlando el efecto AE ya compilado)
queda validada.

## 6. Etapa 2 (interfaz real)

El panel ahora tiene:

- **Grilla de Looks**: 15 miniaturas (3 columnas). Clic en una la aplica de
  inmediato al clip seleccionado — ya no hace falta el boton.
- **Deslizador de Intensity**: arrastralo con el mouse; se aplica al
  soltarlo (no en cada pixel, para no llenar el historial de deshacer de un
  tiron). El numero de la derecha tambien se puede editar escribiendo
  directamente (clic, escribe, Enter).
- **Reutilizacion del efecto**: si el clip seleccionado ya tiene Color Lab
  aplicado, cambiar de Look o mover Intensity actualiza esa misma instancia
  en vez de insertar una nueva cada vez — antes del cambio, cada clic en
  "Aplicar" del prototipo apilaba un componente de efecto adicional.
- El boton "Aplicar al clip seleccionado" sigue disponible (re-aplica los
  valores actuales; util si cambiaste de clip seleccionado).

Que probar en esta etapa:

1. Selecciona un clip, haz clic en varios Looks seguidos: en Controles de
   efectos debe seguir habiendo **una sola** instancia de Color Lab (no una
   por cada clic).
2. Arrastra el deslizador de Intensity de un extremo a otro y suelta: el
   valor debe quedar aplicado, y Cmd/Ctrl+Z debe deshacerlo en un solo paso.
3. Prueba escribir un numero de Intensity a mano (clic en el numero, escribe
   "35", Enter).
4. Cambia de clip seleccionado (uno sin el efecto todavia) y aplica un Look:
   debe insertarse ahi tambien, de forma independiente.
