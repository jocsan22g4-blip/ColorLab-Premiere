/*
 * Color Lab para Premiere — panel UXP, Etapa 2.
 *
 * Construye sobre el prototipo de la Etapa 1 (ver TESTING.md, seccion
 * "Resultado"), ya validado en vivo contra Premiere 26.5.2: matchName
 * "AE.<...>", insercion con createAppendComponentAction dentro de
 * lockedAccess + executeTransaction, Look/Intensity con createSetValueAction,
 * el popup "Look" base-1 en AE pero base-0 en el ComponentParam de Premiere,
 * UXP sin honrar valores HTML por defecto, y un <input type="range"> nativo
 * que se traba al arrastrar en este runtime.
 *
 * Novedades de la Etapa 2:
 *   - Navegador de Looks: tira de numeros (sin miniaturas, por preferencia
 *     explicita de diseno) con el nombre del Look seleccionado debajo.
 *   - Deslizador de Intensity construido a mano (HTML/CSS + Pointer Events),
 *     sin <input type="range">.
 *   - Reaplicar Look/Intensity ya NO apila una instancia nueva del efecto
 *     por cada clic: si el clip seleccionado ya tiene Color Lab en su
 *     cadena, se reutiliza (se detecta por Component.getMatchName()) y solo
 *     se actualizan sus parametros.
 *
 * Novedades de la Etapa 3 (ver la decision registrada en el informe
 * tecnico, 20 oct):
 *   - Seccion "Basic Adjustments": Exposure, Contrast, Temperature, Tint,
 *     Saturation. Mismo widget de slider que Intensity -- se generalizo en
 *     createSlider() en vez de copiar el codigo de arrastre cinco veces
 *     mas. Los nombres visibles tienen que coincidir EXACTO con las
 *     etiquetas que declara ae/ColorLabAE.cpp (PF_ADD_FLOAT_SLIDERX): es
 *     por displayName que este panel encuentra cada parametro.
 *   - Highlights/Shadows/Midtones y Shadow Tint, de la referencia que
 *     mando Jocsan (Color Lab Zero, otro producto), se descartaron por
 *     redundantes: Lift/Gamma/Gain cubre el primero (pendiente, UI de
 *     ruedas de color) y Split Tone ya cubre el segundo.
 *   - Doble clic en cualquier slider (Intensity incluido) = volver a su
 *     valor por defecto. Mismo gesto que "Reset Parameter" en Effect
 *     Controls/After Effects.
 *   - EL PANEL YA NO PISA LO QUE AJUSTES EN CONTROLES DE EFECTOS. Cada
 *     gesto escribe UNICAMENTE su propio parametro (writeParams acepta
 *     `only`). Antes escribia los seis en cada aplicacion, asi que poner
 *     Intensity a 0 en Controles de efectos y luego tocar el panel la
 *     devolvia a 100 -- costo real: durante la caza del banding del 21 oct
 *     creimos tener el efecto a 0 y el log del propio efecto demostro que
 *     corria a 100. La excepcion es la primera insercion en un clip: ahi
 *     el panel es la unica fuente de verdad y vuelca todo.
 *   - Vista previa en vivo mientras se arrastra, no solo al soltar. La
 *     logica de Premiere se partio en dos: resolveTarget() (lo caro --
 *     seleccion, matchName, cadena, buscar/insertar el componente) y
 *     writeParams() (lo barato -- escribir los parametros ya resueltos).
 *     Un arrastre resuelve el target UNA vez al empezar y reutiliza ese
 *     mismo target en cada escritura en vivo; repetir resolveTarget() en
 *     cada pointermove recorreria la cadena entera (con getMatchName()
 *     async por componente) decenas de veces por segundo. Las escrituras
 *     en vivo ademas van con throttle (LIVE_INTERVAL_MS) para no saturar
 *     el puente con Premiere ni, probablemente, el historial de deshacer
 *     -- EN PREMIERE REAL HAY QUE CONFIRMAR si Cmd+Z deshace un arrastre
 *     entero de un tiron o paso a paso; si es paso a paso puede hacer
 *     falta agrupar las escrituras en una sola transaccion de deshacer.
 */

const premierepro = require("premierepro");

// Debe coincidir exactamente, en el mismo orden, con looks/looks.manifest
// de ColorLab-3. El indice que se envia al parametro "Look" es 1-based
// (como el popup de After Effects); ids del manifiesto: look_01..look_15.
const LOOKS = [
  { id: "look_01", name: "Nature" },
  { id: "look_02", name: "Amber" },
  { id: "look_03", name: "Sage" },
  { id: "look_04", name: "Ember" },
  { id: "look_05", name: "Emerald" },
  { id: "look_06", name: "Haze" },
  { id: "look_07", name: "Velvet" },
  { id: "look_08", name: "Frost" },
  { id: "look_09", name: "Film" },
  { id: "look_10", name: "Silver" },
  { id: "look_11", name: "Astral" },
  { id: "look_12", name: "Faded" },
  { id: "look_13", name: "Aura" },
  { id: "look_14", name: "Retro" },
  { id: "look_15", name: "Black & White" },
];

const INTENSITY_MIN = 0.0;
const INTENSITY_MAX = 100.0;
const kIntensityDefaultUi = 100.0; // igual a kIntensityDefault en ae/ColorLabAE.h

// Mismos rangos y valores por defecto que kBasic*Min/Max/Default en
// ae/ColorLabAE.h -- si un numero cambia alla, cambia aqui tambien.
const BASIC = {
  exposure:    { min: -5.0,   max: 5.0,   default: 0.0,   decimals: 2, displayName: "Exposure" },
  contrast:    { min: -100.0, max: 100.0, default: 0.0,   decimals: 1, displayName: "Contrast" },
  temperature: { min: -100.0, max: 100.0, default: 0.0,   decimals: 1, displayName: "Temperature" },
  tint:        { min: -100.0, max: 100.0, default: 0.0,   decimals: 1, displayName: "Tint" },
  saturation:  { min: 0.0,    max: 200.0, default: 100.0, decimals: 1, displayName: "Saturation" },
};

const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const lookStripEl = document.getElementById("lookStrip");
const lookIndexLabelEl = document.getElementById("lookIndexLabel");
const lookNameLabelEl = document.getElementById("lookNameLabel");
const btnDiagnose = document.getElementById("btnDiagnose");
const btnApply = document.getElementById("btnApply");

let selectedLookIndex = 1; // 1-based
let cachedMatchName = null; // se resuelve una vez y se reutiliza

// Minimo de tiempo entre dos escrituras en vivo durante un arrastre. 70ms
// (~14 veces por segundo) se ve fluido para una previsualizacion de color
// sin mandar una transaccion por cada pointermove, que en un arrastre
// rapido puede disparar a 60-120 por segundo.
const LIVE_INTERVAL_MS = 70;

function log(msg, level = "info") {
  const stamp = new Date().toLocaleTimeString();
  const prefix = level === "error" ? "ERROR" : level === "warn" ? "AVISO" : "info";
  const line = `[${stamp}] ${prefix}: ${msg}`;
  console.log(line);
  const div = document.createElement("div");
  div.textContent = line;
  if (level === "error") div.style.color = "#ff6b6b";
  if (level === "warn") div.style.color = "#ffd166";
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(msg, level = "info") {
  statusEl.textContent = msg;
  statusEl.className = level === "error" ? "error" : level === "warn" ? "warn" : level === "ok" ? "ok" : "";
}

/* ---------------- Navegador de Looks (tira de numeros) ---------------- */

function buildLookStrip() {
  lookStripEl.innerHTML = "";
  LOOKS.forEach((look, i) => {
    const lookIndex = i + 1; // 1-based, igual que el popup de AE
    // <div> y no <button>: este runtime de UXP pinta el fondo nativo del
    // boton aunque se le pida "appearance: none", y eso se comia el fondo
    // del Look seleccionado (quedaba en un trazo). Ver la nota del CSS en
    // index.html. Como un <div> no es un control, hay que reponerle a mano
    // el rol, el foco y la activacion por teclado.
    const num = document.createElement("div");
    num.className = "look-num";
    num.setAttribute("role", "button");
    num.setAttribute("tabindex", "0");
    num.setAttribute("aria-label", `Look ${lookIndex}: ${look.name}`);
    num.dataset.lookIndex = String(lookIndex);
    num.textContent = String(lookIndex).padStart(2, "0");
    num.title = look.name;
    if (lookIndex === selectedLookIndex) {
      num.classList.add("selected");
      num.setAttribute("aria-pressed", "true");
    }
    num.addEventListener("click", () => selectLook(lookIndex));
    num.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        selectLook(lookIndex);
      }
    });
    lookStripEl.appendChild(num);
  });
  log(`Tira de Looks construida: ${LOOKS.length} opciones.`);
  renderLookReadout();
}

function renderLookReadout() {
  lookIndexLabelEl.textContent = String(selectedLookIndex).padStart(2, "0");
  lookNameLabelEl.textContent = LOOKS[selectedLookIndex - 1]?.name ?? "";
}

/** Marca en la tira cual es el Look puesto. Un solo sitio, porque lo
 *  necesitan tanto el clic del usuario como la sincronizacion desde el
 *  clip, y aria-pressed tiene que seguir a la clase. */
function renderLookStripSelection() {
  [...lookStripEl.children].forEach((num) => {
    const esta = Number(num.dataset.lookIndex) === selectedLookIndex;
    num.classList.toggle("selected", esta);
    if (esta) num.setAttribute("aria-pressed", "true");
    else num.removeAttribute("aria-pressed");
  });
}

function selectLook(lookIndex) {
  if (lookIndex === selectedLookIndex) return;
  selectedLookIndex = lookIndex;
  renderLookStripSelection();
  renderLookReadout();
  applyCurrent({ only: "look" });
}

/* ---------------- Deslizadores (Intensity + Etapa 3) ---------------- */

/**
 * Un deslizador construido a mano (HTML/CSS + Pointer Events), igual que el
 * de Intensity en la Etapa 2 -- generalizado aqui para no repetir el mismo
 * codigo de arrastre seis veces. El <input type="range"> nativo se traba al
 * arrastrarlo en este runtime de UXP (hallazgo de la Etapa 1); de ahi que
 * siga sin usarse.
 *
 * `idPrefix` espera cuatro elementos en el DOM: `${idPrefix}Slider`,
 * `${idPrefix}Mask`, `${idPrefix}Thumb`, `${idPrefix}Value`.
 */
function createSlider({ idPrefix, paramKey, min, max, decimals, defaultValue, onCommit, onChange }) {
  const el = document.getElementById(`${idPrefix}Slider`);
  const maskEl = document.getElementById(`${idPrefix}Mask`);
  const thumbEl = document.getElementById(`${idPrefix}Thumb`);
  const valueEl = document.getElementById(`${idPrefix}Value`);

  let value = defaultValue;
  let dragging = false;

  // --- vista previa en vivo durante el arrastre ---------------------------
  //
  // `liveTarget` se resuelve UNA vez al empezar a arrastrar (pointerdown) y
  // se reutiliza en cada escritura mientras dura el gesto -- ver la nota de
  // cabecera del archivo. Si todavia no esta listo (resolveTarget() es
  // async) o no hay clip valido, las escrituras en vivo simplemente no
  // hacen nada: no se avisa con un error hasta soltar, para no llenar el
  // log de avisos por cada frame sin seleccion.
  let liveTarget = null;
  let liveTimer = null;
  let livePending = false;

  function liveWriteNow() {
    // Solo este control, y en silencio: durante un arrastre no tiene
    // sentido avisar por cada parametro que no se encontro.
    if (liveTarget && liveTarget.ok) {
      writeParams(liveTarget, { only: paramKey, silent: true });
    }
  }

  function scheduleLiveWrite() {
    if (liveTimer) { livePending = true; return; }
    liveWriteNow();
    liveTimer = setTimeout(() => {
      liveTimer = null;
      if (livePending) { livePending = false; scheduleLiveWrite(); }
    }, LIVE_INTERVAL_MS);
  }

  function render() {
    const pct = ((value - min) / (max - min)) * 100;
    // El track muestra siempre el degrade completo de marca; la mascara
    // oscura cubre la parte todavia no "revelada" a la derecha del thumb.
    maskEl.style.width = `${100 - pct}%`;
    thumbEl.style.left = `${pct}%`;
    valueEl.textContent = value.toFixed(decimals);
    // Lo usan los masters de las ruedas: el valor del slider ES el master,
    // y la rueda necesita enterarse para recalcular sus tres canales.
    if (onChange) onChange(value);
  }

  function setFromClientX(clientX) {
    const rect = el.getBoundingClientRect();
    let pct = (clientX - rect.left) / rect.width;
    pct = Math.max(0, Math.min(1, pct));
    value = min + pct * (max - min);
    render();
  }

  el.addEventListener("pointerdown", (ev) => {
    dragging = true;
    el.classList.add("dragging");
    el.setPointerCapture(ev.pointerId);
    setFromClientX(ev.clientX);

    // Resolver el target una vez, al empezar el gesto. Es async -- hasta
    // que no resuelva, scheduleLiveWrite() no tiene nada que escribir.
    liveTarget = null;
    resolveTarget({ silent: true }).then((t) => {
      liveTarget = t;
      if (dragging && t.ok) scheduleLiveWrite();
    });

    ev.preventDefault();
  });
  el.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    setFromClientX(ev.clientX);
    scheduleLiveWrite();
  });
  function finishDrag(ev) {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("dragging");
    try { el.releasePointerCapture(ev.pointerId); } catch {}
    if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; }
    liveTarget = null;
    // Al soltar se vuelve a pasar por el camino completo (onCommit ->
    // applyCurrent -> resolveTarget), por si algo cambio durante el
    // arrastre (p. ej. si el componente no existia y recien se inserto en
    // la primera escritura en vivo) y para que los avisos normales
    // (sin clip seleccionado, etc.) se muestren una vez, al terminar.
    onCommit();
  }
  el.addEventListener("pointerup", finishDrag);
  el.addEventListener("pointercancel", finishDrag);

  // Doble clic sobre el slider (track o thumb) = volver al valor por
  // defecto. Mismo gesto que usan Effect Controls y After Effects para
  // "Reset Parameter" -- no hace falta una casilla aparte por control, y
  // va en el slider (no en el numero) para no chocar con el clic simple
  // que abre la edicion de texto.
  el.addEventListener("dblclick", (ev) => {
    ev.preventDefault();
    value = defaultValue;
    render();
    onCommit();
  });

  // Click en el numero para escribirlo a mano.
  valueEl.addEventListener("click", () => {
    valueEl.contentEditable = "true";
    valueEl.focus();
    document.execCommand && document.execCommand("selectAll", false, null);
  });
  function commitEdit() {
    valueEl.contentEditable = "false";
    let v = Number(String(valueEl.textContent).replace(",", "."));
    if (!Number.isFinite(v)) v = value;
    v = Math.max(min, Math.min(max, v));
    value = v;
    render();
    onCommit();
  }
  valueEl.addEventListener("blur", commitEdit);
  valueEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      valueEl.blur();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      render();
      valueEl.contentEditable = "false";
      valueEl.blur();
    }
  });

  render();

  return {
    get value() { return value; },
    set value(v) { value = Math.max(min, Math.min(max, v)); render(); },
    /// Si el usuario tiene el dedo encima. La sincronizacion desde el clip
    /// lo consulta para no arrancarle el slider de las manos a mitad de un
    /// arrastre.
    get dragging() { return dragging; },
    render,
  };
}

const intensitySlider = createSlider({
  idPrefix: "intensity",
  paramKey: "intensity",
  min: INTENSITY_MIN,
  max: INTENSITY_MAX,
  decimals: 1,
  defaultValue: kIntensityDefaultUi,
  onCommit: () => applyCurrent({ only: "intensity" }),
});

// Etapa 3: un deslizador por entrada de BASIC, con el mismo idPrefix que la
// clave (p. ej. "exposure" -> #exposureSlider/#exposureMask/...).
const basicSliders = {};
for (const [key, cfg] of Object.entries(BASIC)) {
  basicSliders[key] = createSlider({
    idPrefix: key,
    paramKey: key,
    min: cfg.min,
    max: cfg.max,
    decimals: cfg.decimals,
    defaultValue: cfg.default,
    onCommit: () => applyCurrent({ only: key }),
  });
}

/* ---------------- Ruedas de color (Lift / Gamma / Gain) ---------------- */

/*
 * La correccion primaria de tres vias. Cada rueda es un punto arrastrable
 * dentro de un circulo, mas un master bipolar debajo.
 *
 * COMO SE TRADUCE LA POSICION A TRES NUMEROS.
 *
 * El angulo del punto da el tono y la distancia al centro, la fuerza. Los
 * tres primarios se reparten el circulo a 120 grados -- rojo arriba, verde
 * abajo a la izquierda, azul abajo a la derecha -- y el peso de cada canal
 * es el coseno de la diferencia entre su angulo y el del punto. Eso da
 * valores entre -1 y 1: empujar hacia el rojo RESTA de los otros dos, que
 * es justo lo que hace una rueda de verdad.
 *
 * El master suma por igual a los tres canales: sube o baja ese rango tonal
 * sin cambiarle el tono.
 *
 * Los neutros NO son el mismo numero en los tres rangos: lift neutro es 0
 * (es un desplazamiento aditivo) y gamma y gain neutros son 1 (son
 * multiplicadores). De ahi que cada rango tenga su propia base.
 *
 * Las escalas (0.20 para lift, 0.50 para gamma y gain) estan elegidas para
 * que el borde de la rueda sea un ajuste fuerte pero todavia utilizable,
 * no un destrozo. Los limites duros son los de ae/ColorLabAE.h.
 */

const LGG = {
  lift:  { base: 0.0, escala: 0.20, masterEscala: 0.25, min: -1.0, max: 1.0,
           params: ["Lift Red", "Lift Green", "Lift Blue"] },
  gamma: { base: 1.0, escala: 0.50, masterEscala: 0.50, min: 0.10, max: 4.0,
           params: ["Gamma Red", "Gamma Green", "Gamma Blue"] },
  gain:  { base: 1.0, escala: 0.50, masterEscala: 0.50, min: 0.0,  max: 4.0,
           params: ["Gain Red", "Gain Green", "Gain Blue"] },
};

// Rojo arriba, y los otros dos a 120 grados. En coordenadas de pantalla la
// Y crece hacia abajo, asi que se invierte al capturar el raton.
const ANGULOS = [
  Math.PI / 2,
  Math.PI / 2 + (2 * Math.PI) / 3,
  Math.PI / 2 + (4 * Math.PI) / 3,
];

function wheelToChannels(rango, x, y, master) {
  const cfg = LGG[rango];
  const r = Math.min(1, Math.hypot(x, y));
  const theta = Math.atan2(y, x);
  const out = [];
  for (let c = 0; c < 3; c++) {
    const peso = Math.cos(theta - ANGULOS[c]);
    let v = cfg.base + master * cfg.masterEscala + r * peso * cfg.escala;
    v = Math.max(cfg.min, Math.min(cfg.max, v));
    out.push(v);
  }
  return out;
}

/**
 * Una rueda: punto arrastrable + master. Mismo contrato que createSlider --
 * escritura en vivo durante el arrastre reutilizando un target resuelto una
 * sola vez, y doble clic para volver al neutro.
 */
function createWheel({ rango, onCommit }) {
  const el = document.getElementById(`${rango}Wheel`);
  const dotEl = document.getElementById(`${rango}Dot`);
  const valueEl = document.getElementById(`${rango}MasterValue`);

  let x = 0, y = 0, master = 0;
  let dragging = false;
  let liveTarget = null, liveTimer = null, livePending = false;

  function render() {
    const radio = el.clientWidth / 2;
    // El punto se queda dentro del circulo.
    const r = Math.min(1, Math.hypot(x, y));
    const theta = Math.atan2(y, x);
    const px = Math.cos(theta) * r * (radio - 8);
    const py = -Math.sin(theta) * r * (radio - 8);   // pantalla: Y hacia abajo
    dotEl.style.left = `${radio + px}px`;
    dotEl.style.top = `${radio + py}px`;
    valueEl.textContent = master.toFixed(2);
  }

  function liveWriteNow() {
    if (liveTarget && liveTarget.ok) {
      writeParams(liveTarget, { only: `lgg:${rango}`, silent: true });
    }
  }
  function scheduleLiveWrite() {
    if (liveTimer) { livePending = true; return; }
    liveWriteNow();
    liveTimer = setTimeout(() => {
      liveTimer = null;
      if (livePending) { livePending = false; scheduleLiveWrite(); }
    }, LIVE_INTERVAL_MS);
  }

  function setFromPointer(ev) {
    const rect = el.getBoundingClientRect();
    const radio = rect.width / 2;
    const dx = (ev.clientX - rect.left - radio) / (radio - 8);
    const dy = -(ev.clientY - rect.top - radio) / (radio - 8);
    const r = Math.hypot(dx, dy);
    if (r > 1) { x = dx / r; y = dy / r; } else { x = dx; y = dy; }
    render();
  }

  el.addEventListener("pointerdown", (ev) => {
    dragging = true;
    el.classList.add("dragging");
    el.setPointerCapture(ev.pointerId);
    setFromPointer(ev);
    liveTarget = null;
    resolveTarget({ silent: true }).then((t) => {
      liveTarget = t;
      if (dragging && t.ok) scheduleLiveWrite();
    });
    ev.preventDefault();
  });
  el.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    setFromPointer(ev);
    scheduleLiveWrite();
  });
  function finishDrag(ev) {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("dragging");
    try { el.releasePointerCapture(ev.pointerId); } catch {}
    if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; }
    liveTarget = null;
    onCommit();
  }
  el.addEventListener("pointerup", finishDrag);
  el.addEventListener("pointercancel", finishDrag);

  el.addEventListener("dblclick", (ev) => {
    ev.preventDefault();
    x = 0; y = 0; master = 0;
    render();
    onCommit();
  });

  const masterSlider = createSlider({
    idPrefix: `${rango}Master`,
    paramKey: `lgg:${rango}`,
    min: -1.0,
    max: 1.0,
    decimals: 2,
    defaultValue: 0.0,
    onCommit,
    onChange: (v) => { master = v; render(); },
  });

  render();

  return {
    get channels() { return wheelToChannels(rango, x, y, master); },
    get dragging() { return dragging || masterSlider.dragging; },
    /** Lleva la rueda a la posicion que representan tres valores leidos
     *  del clip. Es la inversa aproximada de wheelToChannels. */
    setFromChannels(vals) {
      const cfg = LGG[rango];
      const d = vals.map((v) => v - cfg.base);
      const m = (d[0] + d[1] + d[2]) / 3;
      master = Math.max(-1, Math.min(1, m / cfg.masterEscala));
      let sx = 0, sy = 0;
      for (let c = 0; c < 3; c++) {
        const peso = (d[c] - m) / cfg.escala;
        sx += peso * Math.cos(ANGULOS[c]);
        sy += peso * Math.sin(ANGULOS[c]);
      }
      // Los tres cosenos a 120 grados suman 3/2 veces el vector original.
      x = Math.max(-1, Math.min(1, sx * (2 / 3)));
      y = Math.max(-1, Math.min(1, sy * (2 / 3)));
      masterSlider.value = master;
      render();
    },
    render,
  };
}

/* ---------------- Logica de Premiere (de la Etapa 1) ---------------- */

/**
 * Centraliza las 4 comprobaciones de casos limite: sin proyecto, sin
 * secuencia, sin seleccion, o un item que no es de video.
 * Devuelve { ok: true, project, sequence, trackItem } o { ok: false }.
 */
async function getSelectedVideoClip({ silent = false } = {}) {
  const warn = (msg) => { if (!silent) log(msg, "warn"); };
  const err = (msg) => { if (!silent) log(msg, "error"); };

  let project;
  try {
    project = await premierepro.Project.getActiveProject();
  } catch (e) {
    err(`No se pudo leer Project.getActiveProject(): ${e}`);
    return { ok: false, reason: "sin proyecto" };
  }
  if (!project) {
    warn("No hay ningun proyecto abierto en Premiere.");
    return { ok: false, reason: "sin proyecto" };
  }

  let sequence;
  try {
    sequence = await project.getActiveSequence();
  } catch (e) {
    err(`No se pudo leer project.getActiveSequence(): ${e}`);
    return { ok: false, reason: "sin secuencia" };
  }
  if (!sequence) {
    warn("No hay ninguna secuencia activa abierta en el monitor de Programa.");
    return { ok: false, reason: "sin secuencia" };
  }

  let selection;
  try {
    selection = await sequence.getSelection();
  } catch (e) {
    err(`No se pudo leer sequence.getSelection(): ${e}`);
    return { ok: false, reason: "sin seleccion" };
  }

  const items = (await selection?.getTrackItems?.()) ?? [];
  if (!items.length) {
    warn("No hay ningun clip seleccionado en la linea de tiempo.");
    return { ok: false, reason: "sin seleccion" };
  }
  if (items.length > 1 && !silent) {
    log(`Hay ${items.length} clips seleccionados; se usa solo el primero.`, "warn");
  }

  const trackItem = items[0];

  // No hay un metodo documentado "isVideo"; se detecta por duck-typing.
  // Un AudioClipTrackItem tambien expone getComponentChain(), asi que el
  // caso real se distingue por el error al insertar (ver mas abajo), no
  // solo por este chequeo.
  if (typeof trackItem.getComponentChain !== "function") {
    warn("El item seleccionado no tiene getComponentChain() — probablemente no es un clip de video.");
    return { ok: false, reason: "no es video" };
  }

  return { ok: true, project, sequence, trackItem };
}

/** Busca entre los matchNames disponibles el del efecto Color Lab compilado. */
async function findColorLabMatchName() {
  if (cachedMatchName) return cachedMatchName;
  const names = await premierepro.VideoFilterFactory.getMatchNames();
  const candidates = names.filter((n) => /colorlab/i.test(n));
  if (candidates.length === 0) {
    log("Ningun matchName contiene 'colorlab'. Lista completa en consola (DevTools).", "error");
    console.log("matchNames:", names);
    return null;
  }
  if (candidates.length > 1) {
    log(`Varios matchNames coinciden: ${candidates.join(", ")}. Se usa el primero.`, "warn");
  }
  cachedMatchName = candidates[0];
  log(`matchName encontrado: "${cachedMatchName}"`);
  return cachedMatchName;
}

/**
 * Busca en la cadena de componentes del clip uno cuyo matchName coincida
 * (el efecto Color Lab ya aplicado antes). Devuelve su indice o -1.
 *
 * getMatchName() puede ser async (como getComponentChain() o
 * createComponent()) -- un primer intento la leia como valor directo y la
 * comparacion nunca coincidia, asi que cada clic insertaba un componente
 * nuevo en vez de reutilizar el existente. Se usa "await" sobre el
 * resultado en los dos casos (un valor normal tambien se puede "esperar"
 * sin problema) y se loguea cada matchName visto, para poder confirmar en
 * el panel mismo si la deteccion esta funcionando.
 */
async function findExistingComponentIndex(chain, matchName) {
  let count;
  try {
    count = chain.getComponentCount();
  } catch (e) {
    log(`findExistingComponentIndex: getComponentCount() fallo: ${e}`, "warn");
    return -1;
  }
  const seen = [];
  for (let i = 0; i < count; i++) {
    let comp;
    try {
      comp = chain.getComponentAtIndex(i);
    } catch {
      continue;
    }
    try {
      let mn = null;
      if (typeof comp?.getMatchName === "function") {
        mn = await comp.getMatchName();
      }
      seen.push(mn);
      if (mn === matchName) return i;
    } catch (e) {
      seen.push(`(error: ${e})`);
    }
  }
  if (count > 0) {
    log(`Componentes ya en la cadena (${count}): ${seen.map((s) => JSON.stringify(s)).join(", ")}. Ninguno coincide con "${matchName}".`);
  }
  return -1;
}

/**
 * La parte cara: seleccion del clip, matchName, cadena de componentes, y
 * buscar (o insertar) el componente Color Lab. Devuelve
 * `{ ok: true, project, live }` listo para pasarle a writeParams(), o
 * `{ ok: false }` con el motivo ya logueado (salvo que `silent`).
 *
 * Se llama una vez por clic/edicion, y tambien una vez al EMPEZAR cada
 * arrastre (pointerdown) -- no en cada pointermove, ver la nota de
 * cabecera del archivo.
 */
async function resolveTarget({ silent = false, insertIfMissing = true } = {}) {
  const selected = await getSelectedVideoClip({ silent });
  if (!selected.ok) {
    if (!silent) setStatus("Selecciona un clip de video para aplicar el Look.", "warn");
    return { ok: false, reason: selected.reason };
  }
  const { project, trackItem } = selected;

  const matchName = await findColorLabMatchName();
  if (!matchName) {
    if (!silent) setStatus("No se encontro el efecto Color Lab instalado en Premiere.", "error");
    return { ok: false, reason: "sin matchName" };
  }

  let chain;
  try {
    chain = await trackItem.getComponentChain();
  } catch (e) {
    if (!silent) {
      log(`Fallo obteniendo la cadena de video: ${e}`, "error");
      setStatus("No se pudo leer la cadena de video del clip.", "error");
    }
    return { ok: false, reason: "sin cadena" };
  }
  if (!chain) {
    if (!silent) setStatus("getComponentChain() devolvio vacio.", "error");
    return { ok: false, reason: "cadena vacia" };
  }

  let targetIndex = await findExistingComponentIndex(chain, matchName);

  // Si el efecto acaba de nacer en este clip, el panel ES la unica fuente
  // de verdad y hay que volcarle TODOS sus valores. A partir de ahi manda
  // el clip, y el panel solo escribe lo que el usuario mueva.
  let inserted = false;

  // La sincronizacion desde el clip llama con insertIfMissing en falso: un
  // sondeo periodico que INSERTARA el efecto en cada clip que el usuario
  // mire seria un desastre.
  if (targetIndex === -1 && !insertIfMissing) {
    return { ok: false, reason: "el clip no tiene Color Lab" };
  }

  // Si no esta aplicado todavia, insertarlo (transaccion 1). El
  // componente recien creado por VideoFilterFactory no expone
  // getParamCount/getParam hasta que se reinserta y se relee desde la
  // cadena (descubierto en la Etapa 1).
  if (targetIndex === -1) {
    let component, countBefore, appended = false;
    try {
      component = await premierepro.VideoFilterFactory.createComponent(matchName);
      countBefore = chain.getComponentCount();
    } catch (e) {
      if (!silent) {
        log(`Fallo creando el componente: ${e}`, "error");
        setStatus("No se pudo crear el componente del efecto.", "error");
      }
      return { ok: false, reason: "fallo creando componente" };
    }
    try {
      project.lockedAccess(() => {
        appended = project.executeTransaction((compoundAction) => {
          compoundAction.addAction(chain.createAppendComponentAction(component));
        }, "Color Lab: insertar efecto");
      });
    } catch (e) {
      if (!silent) {
        const msg = String(e);
        if (/invalid parameter/i.test(msg)) {
          log(`No se pudo insertar el efecto (Invalid parameter). El item seleccionado probablemente no tiene una cadena de video valida para un filtro de video (p. ej. es en realidad un clip de audio). ${msg}`, "error");
          setStatus("El clip seleccionado no admite efectos de video.", "error");
        } else {
          log(`Fallo insertando el efecto en la cadena: ${msg}`, "error");
          setStatus("Fallo insertando el efecto.", "error");
        }
      }
      return { ok: false, reason: "fallo insertando" };
    }
    if (!appended) {
      if (!silent) setStatus("executeTransaction() de insercion devolvio false.", "error");
      return { ok: false, reason: "insercion devolvio false" };
    }
    targetIndex = countBefore;
    inserted = true;
  }

  let live;
  try {
    live = chain.getComponentAtIndex(targetIndex);
  } catch (e) {
    if (!silent) {
      log(`No se pudo releer el componente (indice ${targetIndex}): ${e}`, "error");
      setStatus("No se pudo releer el efecto insertado.", "error");
    }
    return { ok: false, reason: "fallo releyendo" };
  }
  if (typeof live?.getParamCount !== "function") {
    if (!silent) {
      log("El componente insertado no expone getParamCount().", "error");
      console.log("componente insertado:", live);
      setStatus("El efecto quedo aplicado con valores por defecto; no se pudo escribir Look/Intensity.", "error");
    }
    return { ok: false, reason: "sin getParamCount" };
  }

  return { ok: true, project, live, inserted };
}

/**
 * La parte barata: escribe Look/Intensity/Basic Adjustments sobre un
 * target YA resuelto por resolveTarget(). Sincrona salvo por el propio
 * executeTransaction -- es la que se llama repetidas veces por segundo
 * durante un arrastre en vivo.
 */
function writeParams(target, { only = null, silent = false } = {}) {
  const { project, live } = target;

  // `only` = la clave del unico control que hay que escribir ("look",
  // "intensity", o una clave de BASIC). null = escribirlos todos.
  //
  // POR QUE NO SE ESCRIBEN SIEMPRE TODOS.
  //
  // Antes si, y pisaba al usuario: ajustar Intensity en Controles de
  // efectos y luego tocar cualquier cosa del panel devolvia Intensity al
  // valor del slider del panel. Costo real -- durante la caza del banding
  // creimos tener el efecto a Intensity 0 y el log demostro que corria a
  // 100, porque el panel lo habia reescrito.
  //
  // Dos fuentes de verdad para un mismo parametro es el problema de fondo;
  // escribir solo lo que el usuario acaba de mover lo evita sin tener que
  // leer el estado del clip (que es la otra mitad, pendiente).
  const wants = (key) => only === null || only === key;

  // Marca el momento de la escritura para que el sondeo de sincronizacion
  // no lea un valor viejo justo detras y se pelee con el usuario.
  lastWriteAt = Date.now();

  let ok = false;
  try {
    project.lockedAccess(() => {
      ok = project.executeTransaction((compoundAction) => {
        const count = live.getParamCount();
        let lookParam = null;
        let intensityParam = null;
        // Etapa 3: un parametro por entrada de BASIC, buscado por el
        // mismo displayName que declara ae/ColorLabAE.cpp.
        const basicParams = {};
        const lggParams = {};   // por displayName: "Lift Red", "Gamma Red", ...
        for (let i = 0; i < count; i++) {
          const p = live.getParam(i);
          const nombre = p?.displayName;
          if (nombre === "Look") lookParam = p;
          else if (nombre === "Intensity") intensityParam = p;
          else if (typeof nombre === "string" &&
                   (nombre.startsWith("Lift ") || nombre.startsWith("Gamma ") || nombre.startsWith("Gain "))) {
            lggParams[nombre] = p;
          } else {
            for (const [key, cfg] of Object.entries(BASIC)) {
              if (nombre === cfg.displayName) basicParams[key] = p;
            }
          }
        }

        if (wants("look")) {
          if (lookParam) {
            // El popup "Look" es base-1 en After Effects (PF_ADD_POPUP),
            // pero Premiere interpreta el valor del ComponentParam como
            // indice base-0 -- se resta 1 (hallazgo de la Etapa 1).
            const kf = lookParam.createKeyframe(selectedLookIndex - 1);
            compoundAction.addAction(lookParam.createSetValueAction(kf, true));
          } else if (!silent) {
            log(`No se encontro un parametro llamado "Look" entre ${count} parametros.`, "warn");
          }
        }

        if (wants("intensity")) {
          if (intensityParam) {
            const kf = intensityParam.createKeyframe(intensitySlider.value);
            compoundAction.addAction(intensityParam.createSetValueAction(kf, true));
          } else if (!silent) {
            log(`No se encontro un parametro llamado "Intensity" entre ${count} parametros.`, "warn");
          }
        }

        // Si el .aex instalado todavia es el de la Etapa 2, estos cinco
        // simplemente no aparecen -- se loguea en warn (salvo en vivo,
        // para no llenar el log mientras se arrastra) y el resto del
        // panel (Look/Intensity/Split Tone) sigue funcionando igual.
        for (const [key, cfg] of Object.entries(BASIC)) {
          if (!wants(key)) continue;
          const param = basicParams[key];
          if (!param) {
            if (!silent) log(`No se encontro un parametro llamado "${cfg.displayName}" entre ${count} parametros.`, "warn");
            continue;
          }
          const kf = param.createKeyframe(basicSliders[key].value);
          compoundAction.addAction(param.createSetValueAction(kf, true));
        }

        // Lift / Gamma / Gain: cada rueda escribe SUS TRES canales de una
        // vez, porque mover el punto cambia los tres a la vez. La clave es
        // "lgg:<rango>".
        for (const [rango, cfg] of Object.entries(LGG)) {
          if (!wants(`lgg:${rango}`)) continue;
          const valores = wheels[rango].channels;
          cfg.params.forEach((nombre, c) => {
            const param = lggParams[nombre];
            if (!param) {
              if (!silent) log(`No se encontro un parametro llamado "${nombre}" entre ${count} parametros.`, "warn");
              return;
            }
            const kf = param.createKeyframe(valores[c]);
            compoundAction.addAction(param.createSetValueAction(kf, true));
          });
        }
      }, "Color Lab: aplicar look");
    });
  } catch (e) {
    if (!silent) {
      log(`La transaccion de parametros fallo: ${e}`, "error");
      setStatus("Fallo aplicando Look/Intensity.", "error");
    }
    return false;
  }
  return ok;
}

const wheels = {};
for (const rango of Object.keys(LGG)) {
  wheels[rango] = createWheel({
    rango,
    onCommit: () => applyCurrent({ only: `lgg:${rango}` }),
  });
}

/* ---------------- Sincronizar el panel DESDE el clip ---------------- */

/**
 * Lee el valor actual de un ComponentParam.
 */
// NO SE USA getStartValue(): devuelve un Keyframe, y la propiedad `value`
// de Keyframe esta documentada como SOLO ESCRITURA. Se intento en la
// primera version de esto y, efectivamente, no devolvia nada legible --
// sin lanzar excepcion, que es lo que hizo el primer diagnostico inutil.
//
// El camino que si devuelve el valor es getValueAtTime(TickTime), y el
// TickTime se construye con TickTime.createWithSeconds() /
// createWithTicks(). Se prueban varias formas porque ninguna estaba
// verificada contra este runtime.
let readStrategy = null;   // null = sin resolver, "ninguna" = imposible
let cachedTickTime = null;
let probed = false;        // el primer intento loguea con detalle; el resto, en silencio

function probe(msg, level = "info") {
  if (!probed) log(msg, level);
}

/** Candidatos a TickTime, de mas a menos preferible. */
async function buildTickTimes(sequence) {
  const out = [];

  // 1) La posicion del cabezal: la correcta si el parametro tiene
  //    fotogramas clave.
  try {
    if (sequence && typeof sequence.getPlayerPosition === "function") {
      const t = await sequence.getPlayerPosition();
      if (t) out.push({ label: "getPlayerPosition()", t });
      else probe("getPlayerPosition() devolvio vacio.", "warn");
    } else {
      probe("La secuencia no expone getPlayerPosition().", "warn");
    }
  } catch (e) {
    probe(`getPlayerPosition() fallo: ${e}`, "warn");
  }

  // 2) Tiempo cero. Para un parametro sin animar vale cualquier instante.
  const TT = premierepro?.TickTime;
  if (TT) {
    try {
      if (typeof TT.createWithSeconds === "function") {
        out.push({ label: "TickTime.createWithSeconds(0)", t: TT.createWithSeconds(0) });
      } else {
        probe("TickTime no expone createWithSeconds().", "warn");
      }
    } catch (e) {
      probe(`TickTime.createWithSeconds(0) fallo: ${e}`, "warn");
    }
    try {
      if (typeof TT.createWithTicks === "function") {
        out.push({ label: 'TickTime.createWithTicks("0")', t: TT.createWithTicks("0") });
      }
    } catch (e) {
      probe(`TickTime.createWithTicks("0") fallo: ${e}`, "warn");
    }
    try {
      if (TT.TIME_ZERO) out.push({ label: "TickTime.TIME_ZERO", t: TT.TIME_ZERO });
    } catch {}
  } else {
    probe("El modulo premierepro no expone TickTime.", "warn");
  }

  if (out.length === 0) probe("No se pudo construir ningun TickTime.", "warn");
  return out;
}

/** Saca un numero de lo que sea que devuelva la API. */
function asNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // Por si el runtime devuelve un Keyframe en vez del valor crudo.
  if (v && typeof v === "object") {
    const inner = v.value;
    if (typeof inner === "number" && Number.isFinite(inner)) return inner;
  }
  return null;
}

async function readParamValue(param, tickTimes) {
  if (!param || typeof param.getValueAtTime !== "function") {
    probe("El ComponentParam no expone getValueAtTime().", "warn");
    return null;
  }

  // Si ya se supo que TickTime funciona, se usa solo ese.
  const candidatos = cachedTickTime ? [cachedTickTime] : tickTimes;

  for (const cand of candidatos) {
    try {
      const raw = await param.getValueAtTime(cand.t);
      const v = asNumber(raw);
      if (v !== null) {
        if (readStrategy === null) {
          readStrategy = "valueAtTime";
          cachedTickTime = cand;
          log(`Lectura de parametros: getValueAtTime() con ${cand.label}.`);
        }
        return v;
      }
      probe(`getValueAtTime() con ${cand.label} devolvio ${typeof raw}: ${JSON.stringify(raw)}`, "warn");
    } catch (e) {
      probe(`getValueAtTime() con ${cand.label} fallo: ${e}`, "warn");
    }
  }
  return null;
}

/** Lee del clip los siete valores que el panel controla. */
async function readParamsFromClip(target, sequence) {
  const { live } = target;
  const out = {};
  let count;
  try {
    count = live.getParamCount();
  } catch {
    return out;
  }

  const tickTimes = await buildTickTimes(sequence);

  for (let i = 0; i < count; i++) {
    let p;
    try { p = live.getParam(i); } catch { continue; }
    const name = p?.displayName;
    if (name === "Look") {
      const v = await readParamValue(p, tickTimes);
      // Premiere guarda el popup base-0; el panel es base-1.
      if (v !== null) out.look = Math.round(v) + 1;
    } else if (name === "Intensity") {
      const v = await readParamValue(p, tickTimes);
      if (v !== null) out.intensity = v;
    } else if (typeof name === "string" &&
               (name.startsWith("Lift ") || name.startsWith("Gamma ") || name.startsWith("Gain "))) {
      const v = await readParamValue(p, tickTimes);
      if (v !== null) {
        out.lgg = out.lgg || {};
        out.lgg[name] = v;
      }
    } else {
      for (const [key, cfg] of Object.entries(BASIC)) {
        if (name === cfg.displayName) {
          const v = await readParamValue(p, tickTimes);
          if (v !== null) out[key] = v;
        }
      }
    }
  }

  // El primer sondeo ya dejo escrito en el log todo lo que hizo falta
  // saber; a partir de aqui, silencio.
  if (!probed) {
    probed = true;
    if (readStrategy === null) {
      readStrategy = "ninguna";
      log("No se pudo leer ningun parametro: el panel no se sincronizara con el clip. Las lineas de arriba dicen por que.", "warn");
    }
  }
  return out;
}

/// Cuando el panel escribio por ultima vez. Un sondeo que llegue justo
/// detras de una escritura leeria el valor viejo y lo devolveria al panel,
/// peleandose con el usuario; por eso se deja un margen.
let lastWriteAt = 0;
const SYNC_COOLDOWN_MS = 900;
const SYNC_INTERVAL_MS = 1000;

let syncing = false;

function anySliderDragging() {
  if (intensitySlider.dragging) return true;
  for (const s of Object.values(basicSliders)) {
    if (s.dragging) return true;
  }
  for (const w of Object.values(wheels)) {
    if (w.dragging) return true;
  }
  return false;
}

/**
 * Trae al panel los valores del clip seleccionado.
 *
 * Es lo que hace que cambiar de clip muestre SUS valores, y que lo que
 * ajustes en Controles de efectos aparezca aqui. Se sondea porque no hay
 * un evento documentado de cambio de seleccion en la API de UXP.
 *
 * No inserta el efecto (insertIfMissing: false) y no escribe nada: si el
 * clip no tiene Color Lab, el panel se queda como esta, que son los
 * valores que se aplicarian al pulsar Aplicar.
 */
async function syncFromClip() {
  if (syncing || applying || anySliderDragging()) return;
  if (Date.now() - lastWriteAt < SYNC_COOLDOWN_MS) return;
  if (readStrategy === "ninguna") return; // ya se comprobo que no se puede

  syncing = true;
  try {
    const selected = await getSelectedVideoClip({ silent: true });
    if (!selected.ok) return;

    const target = await resolveTarget({ silent: true, insertIfMissing: false });
    if (!target.ok) return;

    const values = await readParamsFromClip(target, selected.sequence);

    // Volver a comprobar: la lectura es async y el usuario pudo empezar a
    // mover algo mientras tanto.
    if (applying || anySliderDragging()) return;
    if (Date.now() - lastWriteAt < SYNC_COOLDOWN_MS) return;

    let changed = false;

    if (typeof values.look === "number" &&
        values.look >= 1 && values.look <= LOOKS.length &&
        values.look !== selectedLookIndex) {
      selectedLookIndex = values.look;
      renderLookStripSelection();
      renderLookReadout();
      changed = true;
    }

    if (typeof values.intensity === "number" &&
        Math.abs(values.intensity - intensitySlider.value) > 0.05) {
      intensitySlider.value = values.intensity;
      changed = true;
    }

    for (const key of Object.keys(BASIC)) {
      const v = values[key];
      if (typeof v === "number" && Math.abs(v - basicSliders[key].value) > 0.005) {
        basicSliders[key].value = v;
        changed = true;
      }
    }

    // Las ruedas: si los tres canales de un rango llegaron del clip y no
    // coinciden con lo que la rueda esta produciendo, se recoloca el punto.
    if (values.lgg) {
      for (const [rango, cfg] of Object.entries(LGG)) {
        const leidos = cfg.params.map((n) => values.lgg[n]);
        if (leidos.some((v) => typeof v !== "number")) continue;
        const actuales = wheels[rango].channels;
        const difiere = leidos.some((v, i) => Math.abs(v - actuales[i]) > 0.002);
        if (difiere) {
          wheels[rango].setFromChannels(leidos);
          changed = true;
        }
      }
    }

    if (changed) {
      const name = LOOKS[selectedLookIndex - 1]?.name ?? selectedLookIndex;
      setStatus(`Sincronizado con el clip · ${name}`, "ok");
    }
  } catch (e) {
    log(`syncFromClip() fallo: ${e}`, "warn");
  } finally {
    syncing = false;
  }
}

let applying = false;

/**
 * Camino completo: resuelve el target y escribe los parametros. Se usa
 * para el boton Aplicar, el clic en un Look, y al soltar/editar un
 * slider -- en todos esos casos vale la pena pagar el costo de
 * resolveTarget() porque no se repite docenas de veces por segundo.
 */
async function applyCurrent({ only = null } = {}) {
  if (applying) return; // evita solapar transacciones si el usuario encadena clics/arrastres
  applying = true;
  btnApply.disabled = true;
  try {
    const target = await resolveTarget();
    if (!target.ok) return; // resolveTarget() ya puso el status/log correspondiente

    // Si el efecto acaba de insertarse en este clip, se vuelcan todos los
    // valores del panel; si ya estaba, solo el control que el usuario
    // movio (ver la nota de writeParams).
    const ok = writeParams(target, { only: target.inserted ? null : only });
    if (ok) {
      const name = LOOKS[selectedLookIndex - 1]?.name ?? selectedLookIndex;
      setStatus(`${name} · Intensity ${intensitySlider.value.toFixed(1)}`, "ok");
      log(`Aplicado Look=${selectedLookIndex} (${name}), Intensity=${intensitySlider.value.toFixed(1)}.`);
    } else {
      setStatus("executeTransaction() de parametros devolvio false.", "error");
    }
  } finally {
    applying = false;
    btnApply.disabled = false;
  }
}

btnApply.addEventListener("click", () => applyCurrent());

btnDiagnose.addEventListener("click", async () => {
  log("— Diagnostico —");
  cachedMatchName = null; // forzar relectura por si se reinstalo el efecto
  await findColorLabMatchName();
  await getSelectedVideoClip();
  log("— fin del diagnostico —");
});

try {
  buildLookStrip();
} catch (e) {
  log(`buildLookStrip() fallo: ${e}`, "error");
}
log("Panel cargado. Selecciona un Look o ajusta Intensity/Basic Adjustments para aplicarlos al clip seleccionado.");

// Sondeo de sincronizacion. No hay evento documentado de cambio de
// seleccion en la API de UXP, asi que se pregunta cada segundo: es lo que
// hace que cambiar de clip muestre SUS valores y que lo ajustado en
// Controles de efectos aparezca en el panel.
setInterval(() => { syncFromClip(); }, SYNC_INTERVAL_MS);
