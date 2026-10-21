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
    const num = document.createElement("button");
    num.type = "button";
    num.className = "look-num";
    num.dataset.lookIndex = String(lookIndex);
    num.textContent = String(lookIndex).padStart(2, "0");
    num.title = look.name;
    if (lookIndex === selectedLookIndex) num.classList.add("selected");
    num.addEventListener("click", () => selectLook(lookIndex));
    lookStripEl.appendChild(num);
  });
  log(`Tira de Looks construida: ${LOOKS.length} opciones.`);
  renderLookReadout();
}

function renderLookReadout() {
  lookIndexLabelEl.textContent = String(selectedLookIndex).padStart(2, "0");
  lookNameLabelEl.textContent = LOOKS[selectedLookIndex - 1]?.name ?? "";
}

function selectLook(lookIndex) {
  if (lookIndex === selectedLookIndex) return;
  selectedLookIndex = lookIndex;
  [...lookStripEl.children].forEach((num) => {
    num.classList.toggle("selected", Number(num.dataset.lookIndex) === lookIndex);
  });
  renderLookReadout();
  applyCurrent();
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
function createSlider({ idPrefix, min, max, decimals, defaultValue, onCommit }) {
  const el = document.getElementById(`${idPrefix}Slider`);
  const maskEl = document.getElementById(`${idPrefix}Mask`);
  const thumbEl = document.getElementById(`${idPrefix}Thumb`);
  const valueEl = document.getElementById(`${idPrefix}Value`);

  let value = defaultValue;
  let dragging = false;

  function render() {
    const pct = ((value - min) / (max - min)) * 100;
    // El track muestra siempre el degrade completo de marca; la mascara
    // oscura cubre la parte todavia no "revelada" a la derecha del thumb.
    maskEl.style.width = `${100 - pct}%`;
    thumbEl.style.left = `${pct}%`;
    valueEl.textContent = value.toFixed(decimals);
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
    ev.preventDefault();
  });
  el.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    setFromClientX(ev.clientX);
  });
  function finishDrag(ev) {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("dragging");
    try { el.releasePointerCapture(ev.pointerId); } catch {}
    // Solo se llama a Premiere al soltar -- aplicar en cada pixel arrastrado
    // apilaria una llamada de transaccion por frame de movimiento.
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
    render,
  };
}

const intensitySlider = createSlider({
  idPrefix: "intensity",
  min: INTENSITY_MIN,
  max: INTENSITY_MAX,
  decimals: 1,
  defaultValue: kIntensityDefaultUi,
  onCommit: () => applyCurrent(),
});

// Etapa 3: un deslizador por entrada de BASIC, con el mismo idPrefix que la
// clave (p. ej. "exposure" -> #exposureSlider/#exposureMask/...).
const basicSliders = {};
for (const [key, cfg] of Object.entries(BASIC)) {
  basicSliders[key] = createSlider({
    idPrefix: key,
    min: cfg.min,
    max: cfg.max,
    decimals: cfg.decimals,
    defaultValue: cfg.default,
    onCommit: () => applyCurrent(),
  });
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

let applying = false;

/** Aplica (o actualiza) Look/Intensity en el clip actualmente seleccionado. */
async function applyCurrent() {
  if (applying) return; // evita solapar transacciones si el usuario encadena clics/arrastres
  applying = true;
  btnApply.disabled = true;
  try {
    const selected = await getSelectedVideoClip();
    if (!selected.ok) {
      setStatus("Selecciona un clip de video para aplicar el Look.", "warn");
      return;
    }
    const { project, trackItem } = selected;

    const matchName = await findColorLabMatchName();
    if (!matchName) {
      setStatus("No se encontro el efecto Color Lab instalado en Premiere.", "error");
      return;
    }

    let chain;
    try {
      chain = await trackItem.getComponentChain();
    } catch (e) {
      log(`Fallo obteniendo la cadena de video: ${e}`, "error");
      setStatus("No se pudo leer la cadena de video del clip.", "error");
      return;
    }
    if (!chain) {
      setStatus("getComponentChain() devolvio vacio.", "error");
      return;
    }

    let targetIndex = await findExistingComponentIndex(chain, matchName);

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
        log(`Fallo creando el componente: ${e}`, "error");
        setStatus("No se pudo crear el componente del efecto.", "error");
        return;
      }
      try {
        project.lockedAccess(() => {
          appended = project.executeTransaction((compoundAction) => {
            compoundAction.addAction(chain.createAppendComponentAction(component));
          }, "Color Lab: insertar efecto");
        });
      } catch (e) {
        const msg = String(e);
        if (/invalid parameter/i.test(msg)) {
          log(`No se pudo insertar el efecto (Invalid parameter). El item seleccionado probablemente no tiene una cadena de video valida para un filtro de video (p. ej. es en realidad un clip de audio). ${msg}`, "error");
          setStatus("El clip seleccionado no admite efectos de video.", "error");
        } else {
          log(`Fallo insertando el efecto en la cadena: ${msg}`, "error");
          setStatus("Fallo insertando el efecto.", "error");
        }
        return;
      }
      if (!appended) {
        setStatus("executeTransaction() de insercion devolvio false.", "error");
        return;
      }
      targetIndex = countBefore;
    }

    let live;
    try {
      live = chain.getComponentAtIndex(targetIndex);
    } catch (e) {
      log(`No se pudo releer el componente (indice ${targetIndex}): ${e}`, "error");
      setStatus("No se pudo releer el efecto insertado.", "error");
      return;
    }
    if (typeof live?.getParamCount !== "function") {
      log("El componente insertado no expone getParamCount().", "error");
      console.log("componente insertado:", live);
      setStatus("El efecto quedo aplicado con valores por defecto; no se pudo escribir Look/Intensity.", "error");
      return;
    }

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
          for (let i = 0; i < count; i++) {
            const p = live.getParam(i);
            if (p?.displayName === "Look") lookParam = p;
            else if (p?.displayName === "Intensity") intensityParam = p;
            else {
              for (const [key, cfg] of Object.entries(BASIC)) {
                if (p?.displayName === cfg.displayName) basicParams[key] = p;
              }
            }
          }

          if (lookParam) {
            // El popup "Look" es base-1 en After Effects (PF_ADD_POPUP),
            // pero Premiere interpreta el valor del ComponentParam como
            // indice base-0 -- se resta 1 (hallazgo de la Etapa 1).
            const kf = lookParam.createKeyframe(selectedLookIndex - 1);
            compoundAction.addAction(lookParam.createSetValueAction(kf, true));
          } else {
            log(`No se encontro un parametro llamado "Look" entre ${count} parametros.`, "warn");
          }

          if (intensityParam) {
            const kf = intensityParam.createKeyframe(intensitySlider.value);
            compoundAction.addAction(intensityParam.createSetValueAction(kf, true));
          } else {
            log(`No se encontro un parametro llamado "Intensity" entre ${count} parametros.`, "warn");
          }

          // Si el .aex instalado todavia es el de la Etapa 2, estos cinco
          // simplemente no aparecen -- se loguea en warn y el resto del
          // panel (Look/Intensity/Split Tone) sigue funcionando igual.
          for (const [key, cfg] of Object.entries(BASIC)) {
            const param = basicParams[key];
            if (!param) {
              log(`No se encontro un parametro llamado "${cfg.displayName}" entre ${count} parametros.`, "warn");
              continue;
            }
            const kf = param.createKeyframe(basicSliders[key].value);
            compoundAction.addAction(param.createSetValueAction(kf, true));
          }
        }, "Color Lab: aplicar look");
      });
    } catch (e) {
      log(`La transaccion de parametros fallo: ${e}`, "error");
      setStatus("Fallo aplicando Look/Intensity.", "error");
      return;
    }

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
