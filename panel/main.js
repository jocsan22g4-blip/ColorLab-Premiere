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
 * ALCANCE DEL PANEL (decidido el 21 oct, tras retirar lo contrario).
 *
 * Color Lab NO hace correccion primaria. Durante un dia tuvo ajustes
 * basicos (Exposure, Contrast, Temperature, Tint, Saturation) y ruedas de
 * Lift/Gamma/Gain, y se retiraron: Lumetri ya hace eso, duplicarlo
 * obligaba al usuario a elegir donde exponer, y alejaba el producto de su
 * version de Resolve. Las herramientas son Look, Intensity, Division de
 * tonos, Bloom, Halation y Film Grain -- las mismas en los dos hosts. Las
 * cuatro ultimas viven en secciones plegables (ver SECTIONS).
 *
 * EL TINTE DE BLOOM/HALATION VA POR DESLIZADORES (Hue + Saturation) Y NO POR
 * SELECTOR DE COLOR: Premiere 26.5.2 pierde el canal azul cuando un panel UXP
 * escribe un parametro de color (el blanco sale amarillo). Con flotantes no
 * hay problema. "View Bloom" / "View Halation" muestran solo lo que cada capa
 * aporta, para ver en que zonas actua.
 *
 * Novedades de la Etapa 3 que SI se quedan:
 *   - Doble clic en cualquier slider (Intensity incluido) = volver a su
 *     valor por defecto. Mismo gesto que "Reset Parameter" en Effect
 *     Controls/After Effects.
 *   - EL PANEL YA NO PISA LO QUE AJUSTES EN CONTROLES DE EFECTOS. Cada
 *     gesto escribe UNICAMENTE su propio parametro (writeParams acepta
 *     `only`). Antes escribia todos en cada aplicacion, asi que poner
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
function createSlider({ idPrefix, paramKey, min, max, decimals, defaultValue, onCommit, onRender }) {
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
    if (onRender) onRender();
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

/* ---------------- Secciones: Split Tone, Bloom, Halation, Film Grain ---------------- */

/*
 * UNA TABLA, NO CUATRO COPIAS DEL MISMO CODIGO.
 *
 * Rangos y defectos salen de ae/ColorLabAE.cpp / ColorLabAE.h (los rangos
 * de los sliders son los "slider range" blandos de cada PF_ADD_FLOAT_SLIDERX,
 * no los limites duros). Si se tocan alla, hay que tocarlos aqui.
 *
 * POR QUE `name` Y NO UN INDICE. Premiere entrega los parametros por
 * posicion, pero "Amount", "Size", "Threshold", "Tint Hue" y "Tint Saturation" se repiten en
 * varias secciones, asi que el nombre solo no identifica nada. Cada control
 * se ubica por SU SECCION: el parametro "Enable <seccion>" (unico) abre la
 * seccion y los nombres siguientes pertenecen a ella hasta el siguiente
 * "Enable". Ver indexParams().
 *
 * Halation no lleva Blend en el panel, a proposito (se queda en Controles de
 * efectos).
 */
// Mismo orden que kBlendChoices en ae/ColorLabAE.h -- CONGELADO alli, porque
// el host guarda el popup por indice. En Premiere el indice es base-0.
const BLEND_MODES = ["Screen", "Add", "Subtract", "Multiply", "Overlay", "Soft Light", "Hard Light", "Lighten", "Normal"];

const SECTIONS = [
  {
    id: "split", title: "Split Tone", enable: "Enable Split Tone",
    controls: [
      { key: "split.amount",  name: "Amount",    label: "Amount",    kind: "float", min: 0, max: 1,   dec: 3, def: 0.395 },
      { key: "split.pivot",   name: "Pivot",     label: "Pivot",     kind: "float", min: 0, max: 1,   dec: 3, def: 0.300 },
      { key: "split.hue",     name: "Hue Angle", label: "Hue Angle", kind: "float", min: 0, max: 360, dec: 1, def: 89.3 },
      { key: "split.protect", name: "Protect Neutrals", label: "Protect Neutrals", kind: "bool", def: false },
      { key: "split.view",    name: "View Influence",   label: "View Influence",   kind: "bool", def: false },
    ],
  },
  {
    id: "bloom", title: "Bloom", enable: "Enable Bloom",
    controls: [
      { key: "bloom.amount",    name: "Amount",    label: "Amount",    kind: "float", min: 0,   max: 100, dec: 1, def: 35 },
      { key: "bloom.size",      name: "Size",      label: "Size",      kind: "float", min: 0.1, max: 10,  dec: 2, def: 1.5 },
      { key: "bloom.threshold", name: "Threshold", label: "Threshold", kind: "float", min: 0,   max: 100, dec: 1, def: 65 },
      { key: "bloom.tint_hue",  name: "Tint Hue",        label: "Tint Hue",        kind: "float", min: 0, max: 360, dec: 1, def: 21.43, tint: "bloom" },
      { key: "bloom.tint_sat",  name: "Tint Saturation", label: "Tint Saturation", kind: "float", min: 0, max: 100, dec: 1, def: 70,    tint: "bloom" },
      { key: "bloom.blend",     name: "Blend",     label: "Blend",     kind: "choice", options: BLEND_MODES, def: 0 },
      { key: "bloom.view",      name: "View Bloom", label: "View Bloom", kind: "bool", def: false },
    ],
  },
  {
    id: "halo", title: "Halation", enable: "Enable Halation",
    controls: [
      { key: "halo.amount",    name: "Amount",    label: "Amount",    kind: "float", min: 0,    max: 100, dec: 1, def: 40 },
      { key: "halo.size",      name: "Size",      label: "Size",      kind: "float", min: 0.05, max: 1,   dec: 2, def: 0.25 },
      { key: "halo.threshold", name: "Threshold", label: "Threshold", kind: "float", min: 0,    max: 100, dec: 1, def: 60 },
      { key: "halo.edge",      name: "Edge",      label: "Edge",      kind: "float", min: 0,    max: 100, dec: 1, def: 80 },
      { key: "halo.spread",    name: "Spread",    label: "Spread",    kind: "float", min: 0,    max: 100, dec: 1, def: 100 },
      { key: "halo.tint_hue",  name: "Tint Hue",        label: "Tint Hue",        kind: "float", min: 0, max: 360, dec: 1, def: 16.5, tint: "halo" },
      { key: "halo.tint_sat",  name: "Tint Saturation", label: "Tint Saturation", kind: "float", min: 0, max: 100, dec: 1, def: 80,   tint: "halo" },
      { key: "halo.view",      name: "View Halation", label: "View Halation", kind: "bool", def: false },
    ],
  },
  {
    id: "grain", title: "Film Grain", enable: "Enable Film Grain",
    controls: [
      { key: "grain.amount",     name: "Amount",          label: "Amount",          kind: "float", min: 0,    max: 100, dec: 1, def: 35 },
      { key: "grain.size",       name: "Size",            label: "Size",            kind: "float", min: 0.01, max: 0.3, dec: 3, def: 0.035 },
      { key: "grain.chroma",     name: "Chroma",          label: "Chroma",          kind: "float", min: 0,    max: 100, dec: 1, def: 0 },
      { key: "grain.shadows",    name: "Shadows",         label: "Shadows",         kind: "float", min: 0,    max: 150, dec: 1, def: 62 },
      { key: "grain.mids",       name: "Midtones",        label: "Midtones",        kind: "float", min: 0,    max: 150, dec: 1, def: 100 },
      { key: "grain.highs",      name: "Highlights",      label: "Highlights",      kind: "float", min: 0,    max: 150, dec: 1, def: 45 },
      { key: "grain.resolution", name: "Film Resolution", label: "Film Resolution", kind: "float", min: 0,    max: 100, dec: 1, def: 60 },
      { key: "grain.structure",  name: "Structure",       label: "Structure",       kind: "float", min: 0,    max: 100, dec: 1, def: 50 },
    ],
  },
];

/// Todos los controles de las secciones, planos, incluyendo el "Enable" de
/// cada una (clave `<id>.enable`).
const ALL_CONTROLS = [];
for (const sec of SECTIONS) {
  ALL_CONTROLS.push({ key: `${sec.id}.enable`, name: sec.enable, kind: "bool", def: false });
  for (const c of sec.controls) ALL_CONTROLS.push(c);
}

/// clave -> { value, dragging? }. Lo que lee la sincronizacion desde el clip
/// y lo que lee writeParams() para saber que escribir.
const controlUi = {};

function makeEl(tag, className, attrs) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (attrs) for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  return el;
}

/** Interruptor <div role="switch">. Devuelve { el, value }. */
function createSwitch({ el, label, defaultValue, onChange }) {
  let value = defaultValue;
  el.setAttribute("role", "switch");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", label);
  function render() {
    el.classList.toggle("on", value);
    el.setAttribute("aria-checked", value ? "true" : "false");
  }
  function toggle(ev) {
    if (ev) ev.stopPropagation();
    value = !value;
    render();
    onChange(value);
  }
  el.addEventListener("click", toggle);
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(ev); }
  });
  render();
  return {
    el,
    get value() { return value; },
    set value(v) { value = !!v; render(); },
    render,
  };
}

/// HSV con V = 1 -> "rgb(r,g,b)". La misma formula que
/// bridge::TintFromHueSat en el efecto (ae/bridge/GlowView.cpp), para que la
/// muestra del panel sea el color que de verdad se aplica.
function tintCss(hueDeg, satPct) {
  const s = Math.max(0, Math.min(1, satPct / 100));
  let h = ((hueDeg % 360) + 360) % 360;
  const sector = h / 60;
  const i = Math.min(5, Math.floor(sector));
  const f = sector - i;
  const p = 1 - s, q = 1 - s * f, t = 1 - s * (1 - f);
  const [r, g, b] = [[1, t, p], [q, 1, p], [p, 1, t], [p, q, 1], [t, p, 1], [1, p, q]][i];
  const to8 = (v) => Math.round(v * 255);
  return `rgb(${to8(r)},${to8(g)},${to8(b)})`;
}

const tintPreviews = {};   // id de seccion -> <div> de la muestra

function updateTintPreview(secId) {
  const el = tintPreviews[secId];
  const hue = controlUi[`${secId}.tint_hue`];
  const sat = controlUi[`${secId}.tint_sat`];
  if (!el || !hue || !sat) return;
  el.style.backgroundColor = tintCss(hue.value, sat.value);
}

function buildSections() {
  const host = document.getElementById("toolSections");
  host.innerHTML = "";

  for (const sec of SECTIONS) {
    const root = makeEl("div", "tool");
    const head = makeEl("div", "tool-head", { role: "button", tabindex: "0", "aria-expanded": "false" });
    const title = makeEl("span", "tool-title");
    const chev = makeEl("span", "chev");
    chev.textContent = "+";
    title.appendChild(chev);
    title.appendChild(document.createTextNode(sec.title));
    head.appendChild(title);

    const enableUi = createSwitch({
      el: makeEl("div", "switch"),
      label: `Activar ${sec.title}`,
      defaultValue: false,
      onChange: (v) => {
        root.classList.toggle("on", v);
        applyCurrent({ only: `${sec.id}.enable` });
      },
    });
    enableUi.el.appendChild(makeEl("div", "knob"));
    head.appendChild(enableUi.el);
    controlUi[`${sec.id}.enable`] = {
      get value() { return enableUi.value; },
      set value(v) { enableUi.value = v; root.classList.toggle("on", !!v); },
    };

    const body = makeEl("div", "tool-body hidden");
    function fold() {
      const open = body.classList.contains("hidden");
      body.classList.toggle("hidden", !open);
      head.setAttribute("aria-expanded", open ? "true" : "false");
      chev.textContent = open ? "−" : "+";
    }
    head.addEventListener("click", fold);
    head.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); fold(); }
    });

    root.appendChild(head);
    root.appendChild(body);
    host.appendChild(root);

    for (const c of sec.controls) {
      const id = c.key.replace(".", "_");
      if (c.kind === "bool") {
        const row = makeEl("div", "check-row");
        const lab = makeEl("span");
        lab.textContent = c.label;
        row.appendChild(lab);
        const sw = createSwitch({
          el: makeEl("div", "switch"),
          label: c.label,
          defaultValue: c.def,
          onChange: () => applyCurrent({ only: c.key }),
        });
        sw.el.appendChild(makeEl("div", "knob"));
        row.appendChild(sw.el);
        body.appendChild(row);
        controlUi[c.key] = {
          get value() { return sw.value; },
          set value(v) { sw.value = v; },
        };
      } else if (c.kind === "choice") {
        const row = makeEl("div", "control-row");
        const lab = makeEl("label");
        lab.textContent = c.label;
        row.appendChild(lab);
        body.appendChild(row);
        const chips = makeEl("div", "chips");
        let current = c.def;
        const els = c.options.map((label, idx) => {
          const chip = makeEl("div", "chip", { role: "button", tabindex: "0" });
          chip.textContent = label;
          const pick = () => { current = idx; paint(); applyCurrent({ only: c.key }); };
          chip.addEventListener("click", pick);
          chip.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(); }
          });
          chips.appendChild(chip);
          return chip;
        });
        const paint = () => els.forEach((e, i) => e.classList.toggle("selected", i === current));
        paint();
        body.appendChild(chips);
        controlUi[c.key] = {
          get value() { return current; },
          set value(v) { current = Math.max(0, Math.min(c.options.length - 1, Math.round(v))); paint(); },
        };
      } else {
        if (c.tint && c.key.endsWith("tint_hue")) {
          const prev = makeEl("div", "tint-preview", { title: "Color de tinte resultante" });
          tintPreviews[c.tint] = prev;
          body.appendChild(prev);
        }
        const row = makeEl("div", "control-row");
        const lab = makeEl("label");
        lab.textContent = c.label;
        const val = makeEl("span", "slider-value", { id: `${id}Value`, tabindex: "0", title: "Haz clic para escribir un valor" });
        row.appendChild(lab);
        row.appendChild(val);
        body.appendChild(row);

        const slider = makeEl("div", "slider", { id: `${id}Slider` });
        slider.appendChild(makeEl("div", "track"));
        slider.appendChild(makeEl("div", "mask", { id: `${id}Mask` }));
        slider.appendChild(makeEl("div", "thumb", { id: `${id}Thumb` }));
        body.appendChild(slider);

        // Los ids ya estan en el DOM (cuelgan de `host`, que es parte del
        // documento) -- createSlider los busca por getElementById.
        controlUi[c.key] = createSlider({
          idPrefix: id,
          paramKey: c.key,
          min: c.min,
          max: c.max,
          decimals: c.dec,
          defaultValue: c.def,
          onCommit: () => applyCurrent({ only: c.key }),
          onRender: c.tint ? () => updateTintPreview(c.tint) : null,
        });
        if (c.tint) updateTintPreview(c.tint);
      }
    }
  }
}

/// Sliders que el usuario tiene agarrados ahora mismo (Intensity incluido).
function anyControlDragging() {
  if (intensitySlider.dragging) return true;
  for (const key of Object.keys(controlUi)) {
    if (controlUi[key].dragging) return true;
  }
  return false;
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
 * Localiza cada parametro del componente. Look e Intensity van por nombre
 * (son unicos); el resto, por seccion -- ver la nota de SECTIONS.
 * Devuelve { map: clave -> ComponentParam, count }.
 */
function indexParams(live) {
  const map = {};
  const count = live.getParamCount();
  let section = null;
  for (let i = 0; i < count; i++) {
    let p;
    try { p = live.getParam(i); } catch { continue; }
    const name = p?.displayName;
    if (name === "Look") { map.look = p; continue; }
    if (name === "Intensity") { map.intensity = p; continue; }
    const opening = SECTIONS.find((sec) => sec.enable === name);
    if (opening) {
      section = opening;
      map[`${opening.id}.enable`] = p;
      continue;
    }
    if (section) {
      const c = section.controls.find((x) => x.name === name);
      if (c && !map[c.key]) map[c.key] = p;
    }
  }
  return { map, count };
}

/// Crea el fotograma clave. Las casillas se intentan primero como booleano;
/// si el runtime no lo acepta, como 0/1 (no esta verificado cual quiere).
function makeKeyframe(param, control, value) {
  if (control.kind === "choice") return param.createKeyframe(value);   // base-0, como Look
  if (control.kind !== "bool") return param.createKeyframe(value);
  try {
    return param.createKeyframe(!!value);
  } catch (e) {
    log(`createKeyframe(boolean) fallo para "${control.name}" (${e}); se prueba con 0/1.`, "warn");
    return param.createKeyframe(value ? 1 : 0);
  }
}

/**
 * La parte barata: escribe Look, Intensity y las secciones sobre un
 * target YA resuelto por resolveTarget(). Sincrona salvo por el propio
 * executeTransaction -- es la que se llama repetidas veces por segundo
 * durante un arrastre en vivo.
 */
function writeParams(target, { only = null, silent = false } = {}) {
  const { project, live } = target;

  // `only` = la clave del unico control que hay que escribir ("look" o
  // "intensity"). null = escribirlos todos.
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
        const { map, count } = indexParams(live);
        const lookParam = map.look || null;
        const intensityParam = map.intensity || null;

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

        for (const c of ALL_CONTROLS) {
          if (!wants(c.key)) continue;
          const param = map[c.key];
          const ui = controlUi[c.key];
          if (!param || !ui) {
            if (!silent) log(`No se encontro el parametro "${c.name}" (${c.key}) entre ${count} parametros.`, "warn");
            continue;
          }
          const kf = makeKeyframe(param, c, ui.value);
          if (kf) compoundAction.addAction(param.createSetValueAction(kf, true));
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
  if (typeof v === "boolean") return v ? 1 : 0;   // casillas
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

/// Lo que devolvio el runtime, como texto corto, para el log.
function shapeOf(raw) {
  let json;
  try { json = JSON.stringify(raw); } catch { json = String(raw); }
  return `${raw === null ? "null" : typeof raw}: ${json}`;
}

const loggedBoolShapes = new Set();

/**
 * Lee una casilla (Enable, View...). Devuelve true / false, o null si no se
 * pudo saber.
 *
 * POR QUE NO VA POR readParamValue.
 *
 * readParamValue solo entiende numeros y booleanos y, ante cualquier otra
 * cosa, devuelve null: "no se pudo leer", y el panel se queda con lo que
 * tenia. Para una casilla eso es un fallo: al pasar de un clip con Split
 * Tone ENCENDIDO a otro con el efecto aplicado pero Split Tone APAGADO, el
 * panel seguia mostrandolo encendido (reportado el 21 oct en Premiere real).
 * Si Premiere devuelve para "casilla apagada" algo que no es un booleano ni
 * un numero (nulo, vacio, texto), el valor se perdia justo en el caso que
 * mas importa.
 *
 * Una lectura que RESUELVE pero sin valor se interpreta como apagada; una
 * que LANZA una excepcion sigue siendo "no se sabe". La forma exacta que
 * devuelve Premiere queda en el log, una vez por forma distinta.
 */
async function readBoolValue(param, tickTimes) {
  if (!param || typeof param.getValueAtTime !== "function") return null;
  const candidatos = cachedTickTime ? [cachedTickTime] : tickTimes;
  for (const cand of candidatos) {
    let raw;
    try {
      raw = await param.getValueAtTime(cand.t);
    } catch {
      continue;
    }
    if (typeof raw === "boolean") return raw;
    const n = asNumber(raw);
    if (n !== null) return n >= 0.5;

    let verdict = null;
    if (raw === null || raw === undefined) verdict = false;
    else if (typeof raw === "string") {
      if (/^\s*(true|1|on|yes)\s*$/i.test(raw)) verdict = true;
      else if (/^\s*(false|0|off|no)?\s*$/i.test(raw)) verdict = false;
    }
    const shape = shapeOf(raw);
    if (!loggedBoolShapes.has(shape)) {
      loggedBoolShapes.add(shape);
      log(`Casilla leida como ${shape} -> se interpreta como ${verdict === null ? "desconocida" : (verdict ? "encendida" : "apagada")}.`, "warn");
    }
    return verdict;
  }
  return null;
}

/** Lee del clip todo lo que el panel controla. */
async function readParamsFromClip(target, sequence) {
  const { live } = target;
  const out = {};
  let map;
  try {
    map = indexParams(live).map;
  } catch {
    return out;
  }

  const tickTimes = await buildTickTimes(sequence);

  // Look primero y solo: la primera lectura decide que TickTime funciona y
  // lo deja en cache; el resto va en paralelo ya con ese dato.
  if (map.look) {
    const v = await readParamValue(map.look, tickTimes);
    // Premiere guarda el popup base-0; el panel es base-1.
    if (v !== null) out.look = Math.round(v) + 1;
  }
  if (map.intensity) {
    const v = await readParamValue(map.intensity, tickTimes);
    if (v !== null) out.intensity = v;
  }

  await Promise.all(ALL_CONTROLS.map(async (c) => {
    const p = map[c.key];
    if (!p) return;
    if (c.kind === "bool") {
      const b = await readBoolValue(p, tickTimes);
      if (b !== null) out[c.key] = b;
      return;
    }
    const v = await readParamValue(p, tickTimes);
    if (v === null) return;
    out[c.key] = c.kind === "choice" ? Math.round(v) : v;
  }));

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
  return anyControlDragging();
}

/// Devuelve el panel a los valores por defecto del efecto. true si algo cambio.
function resetPanelToDefaults() {
  let changed = false;

  if (selectedLookIndex !== 1) {
    selectedLookIndex = 1;
    renderLookStripSelection();
    renderLookReadout();
    changed = true;
  }
  if (Math.abs(intensitySlider.value - kIntensityDefaultUi) > 0.05) {
    intensitySlider.value = kIntensityDefaultUi;
    changed = true;
  }
  for (const c of ALL_CONTROLS) {
    const ui = controlUi[c.key];
    if (!ui) continue;
    if (c.kind === "bool" || c.kind === "choice") {
      if (ui.value !== c.def) { ui.value = c.def; changed = true; }
    } else if (Math.abs(ui.value - c.def) > 0.5 * Math.pow(10, -c.dec)) {
      ui.value = c.def;
      changed = true;
    }
  }
  return changed;
}

/**
 * Trae al panel los valores del clip seleccionado.
 *
 * Es lo que hace que cambiar de clip muestre SUS valores, y que lo que
 * ajustes en Controles de efectos aparezca aqui. Se sondea porque no hay
 * un evento documentado de cambio de seleccion en la API de UXP.
 *
 * No inserta el efecto (insertIfMissing: false) y no escribe nada: si el
 * clip no tiene Color Lab, el panel vuelve a los valores por defecto
 * (resetPanelToDefaults), que son los que se volcarian al insertarlo.
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
    if (!target.ok) {
      // Un clip SIN Color Lab: el panel vuelve a los valores por defecto.
      // Antes se quedaba como estaba, y al saltar de un clip con Bloom
      // activado a otro sin el efecto, el panel seguia mostrando Bloom
      // encendido cuando Controles de efectos no mostraba nada. No se pierde
      // nada: tocar cualquier control inserta el efecto con los valores del
      // panel, asi que el panel nunca guarda un estado "a medias".
      if (target.reason === "el clip no tiene Color Lab") {
        if (applying || anySliderDragging()) return;
        if (Date.now() - lastWriteAt < SYNC_COOLDOWN_MS) return;
        if (resetPanelToDefaults()) setStatus("Este clip no tiene Color Lab · valores por defecto", "info");
      }
      return;
    }

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

    for (const c of ALL_CONTROLS) {
      const v = values[c.key];
      const ui = controlUi[c.key];
      if (v === undefined || !ui) continue;
      if (c.kind === "bool") {
        if (!!v !== ui.value) { ui.value = v; changed = true; }
      } else if (c.kind === "choice") {
        if (v !== ui.value) { ui.value = v; changed = true; }
      } else {
        const tol = 0.5 * Math.pow(10, -c.dec);
        if (Math.abs(v - ui.value) > tol) { ui.value = v; changed = true; }
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
  // Que parametros de Color Lab se encontraron en el clip, y cuales faltan.
  // Es lo primero que hay que mirar si una seccion no responde.
  try {
    const target = await resolveTarget({ silent: true, insertIfMissing: false });
    if (!target.ok) {
      log("El clip seleccionado no tiene Color Lab: no hay parametros que listar.", "warn");
    } else {
      const { map, count } = indexParams(target.live);
      const missing = [];
      if (!map.look) missing.push("Look");
      if (!map.intensity) missing.push("Intensity");
      for (const c of ALL_CONTROLS) if (!map[c.key]) missing.push(c.key);
      log(`Parametros del efecto: ${count}. Ubicados por el panel: ${Object.keys(map).length} de ${2 + ALL_CONTROLS.length}.`);
      if (missing.length) log(`No ubicados: ${missing.join(", ")}`, "warn");
      const names = [];
      for (let i = 0; i < count; i++) {
        try { names.push(`${i}:${target.live.getParam(i)?.displayName ?? "?"}`); } catch { names.push(`${i}:?`); }
      }
      log(`Orden en Premiere -> ${names.join(" | ")}`);

      // Lo que Premiere DEVUELVE para cada parametro, tal cual. Es lo que hay
      // que mirar cuando el panel y Controles de efectos no coinciden.
      try {
        const sel = await getSelectedVideoClip({ silent: true });
        const tt = await buildTickTimes(sel.ok ? sel.sequence : null);
        const t = (cachedTickTime || tt[0])?.t;
        if (t) {
          const lines = [];
          for (let i = 0; i < count; i++) {
            let p; try { p = target.live.getParam(i); } catch { continue; }
            if (!p?.displayName) continue;
            let txt;
            try { txt = shapeOf(await p.getValueAtTime(t)); } catch (e) { txt = `ERROR ${e}`; }
            lines.push(`${i}:${p.displayName}=${txt}`);
          }
          log(`Valores crudos -> ${lines.join(" | ")}`);
        }
      } catch (e) {
        log(`Volcado de valores fallo: ${e}`, "warn");
      }
    }
  } catch (e) {
    log(`Diagnostico de parametros fallo: ${e}`, "warn");
  }
  log("— fin del diagnostico —");
});

try {
  buildLookStrip();
} catch (e) {
  log(`buildLookStrip() fallo: ${e}`, "error");
}
try {
  buildSections();
} catch (e) {
  log(`buildSections() fallo: ${e}`, "error");
}
log("Panel cargado. Selecciona un Look o ajusta cualquier control para aplicarlo al clip seleccionado.");

// Sondeo de sincronizacion. No hay evento documentado de cambio de
// seleccion en la API de UXP, asi que se pregunta cada segundo: es lo que
// hace que cambiar de clip muestre SUS valores y que lo ajustado en
// Controles de efectos aparezca en el panel.
setInterval(() => { syncFromClip(); }, SYNC_INTERVAL_MS);
