# Probar el panel

Las secciones 0-5 son el prototipo de la Etapa 1 (ya validado) y se dejan
como referencia de los hallazgos. Lo vigente para el panel actual esta en las
secciones 6 y 7.

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
3. En UDT, sobre el plugin **"Color Lab"**, pulsa **Load & Watch**
   (recomendado — recarga sola si edito el código; si cambio
   `manifest.json` hay que **Unload** y volver a cargar).
4. Busca la notificación en la parte inferior de UDT: verde = cargó bien;
   roja con **Details** = error, ábrelo y pégame el log.
5. El panel "Color Lab" debería aparecer como panel acoplable
   en Premiere (**Window → Extensions**, o ya visible si UDT lo abrió).

## 4. Qué verificar en la Etapa 1 (las 6 preguntas del informe — histórico)

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

## 6. Panel actual

Lo que hay y como comprobarlo en Premiere real:

- **Look e Intensity.** Clic en un numero de la tira aplica el Look; el
  seleccionado va en blanco. En Controles de efectos debe haber **una sola**
  instancia de Color Lab aunque cambies de Look muchas veces.
- **Secciones** (Split Tone, Bloom, Halation, Film Grain): se despliegan con
  la cabecera y se activan con el interruptor. Activar una seccion en el
  panel debe verse en Controles de efectos y al reves.
- **Bloom:** Tint Hue / Tint Saturation (la muestra de color es el tinte
  aplicado), Blend y View Bloom. **Halation:** igual, sin Blend en el panel.
- **View Bloom / View Halation:** muestran solo lo que cada capa aporta
  (sobre negro, con ganancia x3). Requiere que la seccion este activa y con
  Amount > 0. No existe en la edicion DEMO.
- **Aplicar / Restaurar.** Aplicar vuelca los valores del panel al clip.
  Restaurar **quita Color Lab del clip** (todas sus instancias) y deja el
  panel en los valores por defecto; Cmd/Ctrl+Z lo trae de vuelta (confirmar
  en Premiere real).
- **Doble clic** en cualquier slider = valor por defecto. Clic en el numero
  = escribirlo a mano.
- **Sincronizacion:** cambia entre un clip con Color Lab y otro sin el: el
  panel debe pasar a los valores del clip, o a los defectos si no lo tiene.
  Prueba sobre todo una casilla encendida en un clip y apagada en otro.
- **Deshacer:** Cmd/Ctrl+Z tras un arrastre — *pendiente de confirmar* si
  deshace el gesto entero o paso a paso (las escrituras en vivo van cada
  70 ms).

### Si el panel y Controles de efectos no coinciden

Abre **Diagnostico** → **Listar efectos y clip seleccionado**. El log dice
cuantos parametros ubico el panel (esperado: 34 de 34), cuales faltan, el
orden que ve Premiere y el **valor crudo** que devuelve cada parametro. Esa
linea es lo primero que hay que mirar: asi se encontro que las casillas
llegan como `{"value": true|false}`.

### Notas de UXP (cada una costo una prueba en Premiere real)

- `<button>` se pinta con el aspecto nativo del SO aunque se ponga
  `appearance: none`: usar `<div role="button">` con `border` (no
  `box-shadow: inset`).
- El `<body>` no se desplaza: el contenido va en `#app` (absoluto,
  `overflow-y: auto`).
- `<input type="range">` nativo se traba; los valores por defecto del HTML no
  se honran; CSS `aspect-ratio` no es fiable; en Grid hace falta
  `min-width: 0`.
- Leer un parametro: `Keyframe.value` no sirve para leer; se usa
  `getValueAtTime(TickTime)`. Las casillas devuelven `{"value": bool}`.
- Escribir un parametro de **color** pierde el canal azul (error de Adobe,
  26.0.2 a 26.5.2 al menos).
- El popup "Look" es base-1 en After Effects y base-0 en Premiere.
- El manifiesto no puede forzar el tamano ni la posicion del panel: solo
  pide un minimo (320x600). Lo fiable es acoplarlo y guardar el espacio de
  trabajo.
- Los tamanos y el manifiesto solo se recargan con **Unload** + volver a
  cargar en UDT.

## 7. Banding con material log (21 oct 2026)

Con una toma D-Log de dron, aplicar Color Lab daba banding incluso con
Intensity 0 y todo apagado. **No era el efecto:** con todo en neutro el frame
sale identico bit a bit (lo vigila `tests/test_neutral_identity.cpp` en
ColorLab-3). Se midio el buffer que entrega Premiere al efecto: con un
efecto en la cadena y la secuencia sin *Maximum Bit Depth*, Premiere lo
rasteriza a 8 bits antes de pasarlo.

Para trabajar con material log:

1. Secuencia con **Maximum Bit Depth** y **Maximum Render Quality**
   activados.
2. Monitor de Programa a **resolucion completa** (a 1/4 se ve mas banding).
3. Si se sospecha del efecto, el diagnostico del render
   (`ae/RenderDiagnostics.h` en ColorLab-3) mide lo que llega y lo que sale.
