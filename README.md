# Color Lab — Premiere Pro

Panel independiente de Color Lab para Adobe Premiere Pro. El **efecto de
video** (el que procesa los pixeles) vive en el repositorio
[`ColorLab-3`](https://github.com/jocsan22g4-blip/ColorLab-3), carpeta `ae/`,
compilado con el After Effects SDK — es la unica via soportada por Adobe para
un efecto de video nativo en Premiere. Este repositorio solo contiene el
**panel de interfaz** (UXP) y, mas adelante, el instalador que coloca ambas
piezas en la maquina del usuario.

## Estado actual: Etapa 1 — prototipo de viabilidad

`panel/` es el prototipo minimo descrito en la seccion 9 del informe tecnico
de Fase 1: valida si un panel UXP puro puede controlar el efecto ya
compilado (aplicarlo a un clip y escribir Look e Intensity), antes de
construir nada mas encima. Ver [`TESTING.md`](./TESTING.md) para cargarlo y
la lista de verificacion.

Fuera de alcance en esta etapa (a proposito): identidad visual final,
miniaturas de Looks, perfiles de camara, Windows, UXP Hybrid.

## Estructura

```
panel/
  manifest.json   manifiesto UXP (host: Premiere Pro, 25.6+)
  index.html      UI minima: Look, Intensity, Diagnosticar, Aplicar
  main.js         logica: selecciona el clip, aplica el efecto, log de diagnostico
TESTING.md        como cargar el panel en Premiere y que verificar
```
