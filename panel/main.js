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
 *   - Navegador de Looks con miniaturas (panel/assets/looks/look_XX.jpg,
 *     generadas a partir de los .cube de ColorLab-3/looks sobre una imagen
 *     de referencia sintetica -- no hay footage de muestra en el repo).
 *   - Deslizador de Intensity construido a mano (HTML/CSS + Pointer Events),
 *     sin <input type="range">.
 *   - Reaplicar Look/Intensity ya NO apila una instancia nueva del efecto
 *     por cada clic: si el clip seleccionado ya tiene Color Lab en su
 *     cadena, se reutiliza (se detecta por Component.getMatchName()) y solo
 *     se actualizan sus parametros.
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
const lookGridEl = document.getElementById("lookGrid");
const btnDiagnose = document.getElementById("btnDiagnose");
const btnApply = document.getElementById("btnApply");

const sliderEl = document.getElementById("intensitySlider");
const sliderFillEl = document.getElementById("intensityFill");
const sliderThumbEl = document.getElementById("intensityThumb");
const intensityValueEl = document.getElementById("intensityValue");

let selectedLookIndex = 1; // 1-based
let intensityValue = kIntensityDefaultUi;
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

/* ---------------- Navegador de Looks ---------------- */

function buildLookGrid() {
  lookGridEl.innerHTML = "";
  let thumbsOk = 0;
  let thumbsFailed = 0;

  LOOKS.forEach((look, i) => {
    const lookIndex = i + 1; // 1-based, igual que el popup de AE
    const card = document.createElement("button");
    card.type = "button";
    card.className = "look-card";
    card.dataset.lookIndex = String(lookIndex);
    if (lookIndex === selectedLookIndex) card.classList.add("selected");

    const thumb = document.createElement("div");
    thumb.className = "look-thumb";

    const label = document.createElement("span");
    label.className = "look-name";
    label.textContent = look.name;

    card.appendChild(thumb);
    card.appendChild(label);
    // El listener va en el boton completo (no en la miniatura), asi que
    // funciona incluso si la imagen de fondo nunca cargo.
    card.addEventListener("click", () => selectLook(lookIndex));
    lookGridEl.appendChild(card);

    // Precarga la miniatura con un Image() aparte en vez de depender de un
    // <img> en el DOM: asi se puede loguear explicitamente si una
    // miniatura no cargo, en vez de quedar en silencio con una caja vacia.
    const src = `./assets/looks/${look.id}.jpg`;
    const pre = new Image();
    pre.onload = () => {
      thumb.style.backgroundImage = `url("${src}")`;
      thumbsOk++;
    };
    pre.onerror = () => {
      thumbsFailed++;
      log(`No se pudo cargar la miniatura de "${look.name}" (${src}).`, "warn");
    };
    pre.src = src;
  });

  log(`Grilla de Looks construida: ${LOOKS.length} tarjetas.`);
  // Da tiempo a que las cargas de imagen (sincronas desde el propio
  // paquete del panel) terminen antes de resumir.
  setTimeout(() => {
    if (thumbsFailed > 0) {
      log(`${thumbsOk} miniaturas cargaron, ${thumbsFailed} fallaron -- revisa que panel/assets/looks este junto a index.html.`, "warn");
    }
  }, 500);
}

function selectLook(lookIndex) {
  if (lookIndex === selectedLookIndex) return;
  selectedLookIndex = lookIndex;
  [...lookGridEl.children].forEach((card) => {
    card.classList.toggle("selected", Number(card.dataset.lookIndex) === lookIndex);
  });
  applyCurrent();
}

/* ---------------- Deslizador de Intensity ---------------- */

function renderIntensityUi() {
  const pct = ((intensityValue - INTENSITY_MIN) / (INTENSITY_MAX - INTENSITY_MIN)) * 100;
  sliderFillEl.style.width = `${pct}%`;
  sliderThumbEl.style.left = `${pct}%`;
  intensityValueEl.textContent = intensityValue.toFixed(1);
}

function setIntensityFromClientX(clientX) {
  const rect = sliderEl.getBoundingClientRect();
  let pct = (clientX - rect.left) / rect.width;
  pct = Math.max(0, Math.min(1, pct));
  intensityValue = INTENSITY_MIN + pct * (INTENSITY_MAX - INTENSITY_MIN);
  renderIntensityUi();
}

let draggingSlider = false;

sliderEl.addEventListener("pointerdown", (ev) => {
  draggingSlider = true;
  sliderEl.classList.add("dragging");
  sliderEl.setPointerCapture(ev.pointerId);
  setIntensityFromClientX(ev.clientX);
  ev.preventDefault();
});
sliderEl.addEventListener("pointermove", (ev) => {
  if (!draggingSlider) return;
  setIntensityFromClientX(ev.clientX);
});
function finishSliderDrag(ev) {
  if (!draggingSlider) return;
  draggingSlider = false;
  sliderEl.classList.remove("dragging");
  try { sliderEl.releasePointerCapture(ev.pointerId); } catch {}
  // Solo se llama a Premiere al soltar -- aplicar en cada pixel arrastrado
  // apilaria una llamada de transaccion por frame de movimiento.
  applyCurrent();
}
sliderEl.addEventListener("pointerup", finishSliderDrag);
sliderEl.addEventListener("pointercancel", finishSliderDrag);

// Click en el numero para escribirlo a mano.
intensityValueEl.addEventListener("click", () => {
  intensityValueEl.contentEditable = "true";
  intensityValueEl.focus();
  document.execCommand && document.execCommand("selectAll", false, null);
});
function commitIntensityEdit() {
  intensityValueEl.contentEditable = "false";
  let v = Number(String(intensityValueEl.textContent).replace(",", "."));
  if (!Number.isFinite(v)) v = intensityValue;
  v = Math.max(INTENSITY_MIN, Math.min(INTENSITY_MAX, v));
  intensityValue = v;
  renderIntensityUi();
  applyCurrent();
}
intensityValueEl.addEventListener("blur", commitIntensityEdit);
intensityValueEl.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    intensityValueEl.blur();
  } else if (ev.key === "Escape") {
    ev.preventDefault();
    renderIntensityUi();
    intensityValueEl.contentEditable = "false";
    intensityValueEl.blur();
  }
});

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
          for (let i = 0; i < count; i++) {
            const p = live.getParam(i);
            if (p?.displayName === "Look") lookParam = p;
            if (p?.displayName === "Intensity") intensityParam = p;
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
            const kf = intensityParam.createKeyframe(intensityValue);
            compoundAction.addAction(intensityParam.createSetValueAction(kf, true));
          } else {
            log(`No se encontro un parametro llamado "Intensity" entre ${count} parametros.`, "warn");
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
      setStatus(`${name} · Intensity ${intensityValue.toFixed(1)}`, "ok");
      log(`Aplicado Look=${selectedLookIndex} (${name}), Intensity=${intensityValue.toFixed(1)}.`);
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
  buildLookGrid();
} catch (e) {
  log(`buildLookGrid() fallo: ${e}`, "error");
}
renderIntensityUi();
log("Panel cargado. Selecciona un Look o ajusta Intensity para aplicarlos al clip seleccionado.");
