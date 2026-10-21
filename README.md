# Color Lab — Premiere Pro

Panel independiente de Color Lab para Adobe Premiere Pro. El **efecto de
video** (el que procesa los pixeles) vive en el repositorio
[`ColorLab-3`](https://github.com/jocsan22g4-blip/ColorLab-3), carpeta `ae/`,
compilado con el After Effects SDK — es la unica via soportada por Adobe para
un efecto de video nativo en Premiere. Este repositorio solo contiene el
**panel de interfaz** (UXP) y, mas adelante, el instalador que coloca ambas
piezas en la maquina del usuario.

## Estado actual: Etapa 2 — navegador de Looks e Intensity definitiva

La Etapa 1 (prototipo minimo, seccion 9 del informe tecnico de Fase 1) quedo
validada en Premiere 26.5.2 real: panel UXP puro controlando el efecto AE ya
compilado. La Etapa 2 construye la interfaz real sobre esa base:

- Navegador de Looks con miniaturas (grilla de 15), generadas aplicando cada
  `.cube` de `ColorLab-3/looks/` sobre una imagen de referencia sintetica.
- Deslizador de Intensity construido a mano (HTML/CSS + Pointer Events) — el
  `<input type="range">` nativo se trababa al arrastrarlo en este runtime de
  UXP (hallazgo de la Etapa 1).
- Aplicar ya no apila una instancia nueva del efecto por cada clic: si el
  clip ya tiene Color Lab, se reutiliza (detectado por
  `Component.getMatchName()`) y solo se actualizan sus parametros.
- Seleccionar un Look o soltar el deslizador aplica de inmediato (sin
  depender solo del boton).

Ver [`TESTING.md`](./TESTING.md) para cargarlo y probarlo.

Fuera de alcance todavia (a proposito): identidad visual final de marca,
perfiles de camara, Windows, UXP Hybrid.

## Estructura

```
panel/
  manifest.json       manifiesto UXP (host: Premiere Pro, 25.6+)
  index.html          UI: grilla de Looks, deslizador de Intensity, Aplicar, Diagnostico
  main.js             logica: selecciona el clip, aplica/reutiliza el efecto, log de diagnostico
  assets/looks/*.jpg   miniaturas de los 15 Looks (generadas desde los .cube de ColorLab-3)
TESTING.md             como cargar el panel en Premiere y que verificar
```
