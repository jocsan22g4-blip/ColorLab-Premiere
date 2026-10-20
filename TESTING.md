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

## 5. Después de probar

Pásame:
- El matchName exacto de la pregunta 1.
- Qué funcionó y qué no, de las 6 preguntas.
- Cualquier error en rojo de UDT o en la consola del Debugger (el enlace
  `{}` en la ventana de UDT).

Con eso decidimos si seguimos a la Etapa 2 (navegador de looks con
miniaturas) tal cual, o si hay que ajustar el enfoque.
