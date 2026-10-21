# Color Lab — Premiere Pro

Panel independiente de Color Lab para Adobe Premiere Pro. El **efecto de
video** (el que procesa los pixeles) vive en el repositorio
[`ColorLab-3`](https://github.com/jocsan22g4-blip/ColorLab-3), carpeta `ae/`,
compilado con el After Effects SDK — es la unica via soportada por Adobe para
un efecto de video nativo en Premiere. Este repositorio solo contiene el
**panel de interfaz** (UXP) y, mas adelante, el instalador que coloca ambas
piezas en la maquina del usuario.

## Que hace el panel

Controla el efecto Color Lab del clip seleccionado. Las herramientas son las
mismas que en la version de Resolve:

- **Look** (15) e **Intensity**.
- **Split Tone**, **Bloom**, **Halation** y **Film Grain**, cada una en una
  tarjeta plegable con su interruptor de activar.
- Bloom y Halation: tinte por **Tint Hue + Tint Saturation** y un interruptor
  **View** que muestra solo lo que cada capa aporta. Bloom ademas lleva
  **Blend**.

Color Lab **no hace correccion primaria** (exposicion, contraste, ruedas...):
eso se deja a Lumetri. Durante un dia el efecto tuvo ajustes basicos y
Lift/Gamma/Gain y se retiraron (21 oct 2026).

Comportamiento a tener en cuenta:

- **Se sincroniza con el clip.** Cada segundo lee los valores del clip
  seleccionado: cambiar de clip muestra SUS valores, y lo que cambies en
  Controles de efectos aparece en el panel. Un clip sin Color Lab devuelve el
  panel a los valores por defecto; tocar cualquier control lo inserta.
- **Escribe solo lo que mueves.** Nunca reescribe los demas parametros, asi
  no pisa lo que hayas ajustado en Controles de efectos.
- **Aplicar / Restaurar.** Restaurar quita Color Lab del clip y devuelve el
  panel a los valores por defecto.
- **Vista previa en vivo** mientras arrastras, y **doble clic** en un slider
  para volver a su valor por defecto.

## Dos limitaciones de Premiere que condicionan el diseno

- **El selector de color no se puede escribir desde UXP.** En Premiere 26.5.2
  se pierde el canal azul (el blanco sale amarillo). Por eso el tinte va por
  deslizadores. El codigo de color se quito del panel; esta en el historial.
- **Banding con material log no es del efecto.** Si la secuencia no esta en
  *Maximum Bit Depth*, Premiere rasteriza a 8 bits en cuanto hay un efecto en
  la cadena (y con la vista previa a 1/4 de resolucion tambien se nota).
  Ver `TESTING.md`, seccion 7.

Ver [`TESTING.md`](./TESTING.md) para cargarlo y probarlo.

Fuera de alcance todavia (a proposito): perfiles de camara, Windows,
UXP Hybrid, instalador.

## Estructura

```
panel/
  manifest.json       manifiesto UXP (host: Premiere Pro, 25.6+; tamano minimo 320x600)
  index.html          UI y estilos
  main.js             logica: tabla SECTIONS, sliders propios, sincronizacion, escritura selectiva
  assets/brand/       marca
  assets/looks/*.jpg  miniaturas de los 15 Looks — YA NO SE USAN (la tira es de numeros)
TESTING.md             como cargar el panel en Premiere y que verificar
```


## Camera (log -> Rec.709)

Selector de camara encima de los Looks: None (defecto) + 11 camaras (Sony S-Log3,
Canon C-Log3, Panasonic V-Log, Cinelike D, Blackmagic Gen 5, RED Log3G10, DJI D-Log M,
Mavic 3 D-Log, Mavic Pro D-Log, Apple Log, Apple Log 2). El orden de `CAMERAS` en
`panel/main.js` debe coincidir con `ColorLab-3/ae/cameras/cameras.manifest`.
El popup "Camera" del efecto es base-0 en Premiere (0 = None), como Look.
La conversion usa los .cube del fabricante, horneados en un unico LUT junto al Look
(sin coste por frame); con Split Tone, Bloom o Halation activos corre como pasada previa.

## Aviso de profundidad de bits

Si la secuencia activa tiene apagada "Profundidad de bits máxima"
(`SequenceSettings.getMaximumBitDepth()`, desde Premiere 25.6), el panel muestra
un aviso con un boton "Activar" (`setMaximumBitDepth(true)`). Sin esa opcion
Premiere rasteriza la cadena a 8 bits al haber un efecto y aparece banding que
no viene de Color Lab. Se comprueba cada 3 s; si la API falla, el aviso no se muestra.
