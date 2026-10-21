/*
 * Color Lab para Premiere — prototipo minimo de viabilidad (Etapa 1).
 *
 * Alcance deliberadamente reducido (ver informe "Color Lab para Premiere Pro
 * - informe tecnico, Fase 1", seccion 9): sin identidad visual final, sin
 * miniaturas, sin perfiles de camara, sin Windows, sin Hybrid. Solo Look e
 * Intensity, sobre el efecto ya compilado en ColorLab-3/ae (COLORLAB_BUILD_AE=ON).
 *
 * Este panel responde, en orden, las 6 preguntas de validacion del informe:
 *   1. Que lista VideoFilterFactory.getMatchNames()? (boton Diagnosticar)
 *   2. createComponent + createAppendComponentAction, dentro de
 *      project.lockedAccess + project.executeTransaction, deja el efecto
 *      en el clip y visible en Controles de efectos? (boton Aplicar)
 *   3. Se pueden escribir Look e Intensity con createSetValueAction? Cambia
 *      el frame y funciona el deshacer? (boton Aplicar + verificacion manual
 *      en el monitor de Programa y con Cmd/Ctrl+Z)
 *   4. Que hace el panel sin proyecto, sin secuencia, sin seleccion o con un
 *      clip de audio seleccionado? (ambos botones, manejo de errores abajo)
 *   5. Coincide el frame de Premiere con el de Resolve para el mismo Look y
 *      la misma entrada? -> verificacion manual, fuera del alcance del codigo.
 *   6. Con Bloom activado en 4K, cuanto tarda un frame? -> verificacion manual
 *      en Premiere (Effect Controls -> activar Bloom -> medir reproduccion/export).
 *
 * Los 15 nombres de Look vienen de looks/looks.manifest en ColorLab-3 (orden
 * congelado, 1-indexado porque los popups de After Effects son base 1).
 */

const premierepro = require("premierepro");

// Debe coincidir exactamente, en el mismo orden, con looks/looks.manifest
// de ColorLab-3. El indice que se envia al parametro "Look" es 1-based.
const LOOK_NAMES = [
  "Nature", "Amber", "Sage", "Ember", "Emerald",
  "Haze", "Velvet", "Frost", "Film", "Silver",
  "Astral", "Faded", "Aura", "Retro", "Black & White",
];

const INTENSITY_MIN = 0.0;
const INTENSITY_MAX = 100.0;

const logEl = document.getElementById("log");
const lookSelect = document.getElementById("lookSelect");
const intensityInput = document.getElementById("intensity");
const intensityValueEl = document.getElementById("intensityValue");
const btnDiagnose = document.getElementById("btnDiagnose");
const btnApply = document.getElementById("btnApply");

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

function populateLookDropdown() {
  lookSelect.innerHTML = "";
  LOOK_NAMES.forEach((name, i) => {
    const opt = document.createElement("option");
    opt.value = String(i + 1); // 1-based, igual que el popup de AE
    opt.textContent = `${i + 1}. ${name}`;
    lookSelect.appendChild(opt);
  });
  // No asumir que el runtime de UXP auto-selecciona la primera opcion como
  // lo hace un navegador normal -- se fuerza explicitamente. Sin esto se vio
  // lookSelect.value devolver undefined con el <select> recien poblado.
  lookSelect.selectedIndex = 0;
}

intensityInput.addEventListener("input", () => {
  intensityValueEl.textContent = Number(intensityInput.value).toFixed(1);
});

/**
 * Centraliza las 4 comprobaciones de la pregunta 4 del informe: sin
 * proyecto, sin secuencia, sin seleccion, o un item que no es de video.
 * Devuelve { ok: true, project, sequence, trackItem } o { ok: false }.
 */
async function getSelectedVideoClip() {
  let project;
  try {
    project = await premierepro.Project.getActiveProject();
  } catch (e) {
    log(`No se pudo leer Project.getActiveProject(): ${e}`, "error");
    return { ok: false };
  }
  if (!project) {
    log("No hay ningun proyecto abierto en Premiere.", "warn");
    return { ok: false };
  }

  let sequence;
  try {
    sequence = await project.getActiveSequence();
  } catch (e) {
    log(`No se pudo leer project.getActiveSequence(): ${e}`, "error");
    return { ok: false };
  }
  if (!sequence) {
    log("No hay ninguna secuencia activa abierta en el monitor de Programa.", "warn");
    return { ok: false };
  }

  let selection;
  try {
    selection = await sequence.getSelection();
  } catch (e) {
    log(`No se pudo leer sequence.getSelection(): ${e}`, "error");
    return { ok: false };
  }

  const items = (await selection?.getTrackItems?.()) ?? [];
  if (!items.length) {
    log("No hay ningun clip seleccionado en la linea de tiempo.", "warn");
    return { ok: false };
  }
  if (items.length > 1) {
    log(`Hay ${items.length} clips seleccionados; el prototipo solo usa el primero.`, "warn");
  }

  const trackItem = items[0];

  // No hay un metodo documentado "isVideo"; se detecta por duck-typing:
  // un item de audio no deberia exponer getComponentChain() con una cadena
  // de video util. Si falla, se trata como "no es un clip de video".
  if (typeof trackItem.getComponentChain !== "function") {
    log("El item seleccionado no tiene getComponentChain() — probablemente no es un clip de video.", "warn");
    return { ok: false };
  }

  try {
    const name = await trackItem.getName();
    log(`Clip seleccionado: "${name}".`);
  } catch {
    // no critico, seguimos igual
  }

  return { ok: true, project, sequence, trackItem };
}

/** Busca entre los matchNames disponibles el del efecto Color Lab compilado. */
async function findColorLabMatchName() {
  const names = await premierepro.VideoFilterFactory.getMatchNames();
  log(`VideoFilterFactory.getMatchNames() devolvio ${names.length} nombres.`);

  const candidates = names.filter((n) => /colorlab/i.test(n));
  if (candidates.length === 0) {
    log("Ningun matchName contiene 'colorlab'. Lista completa en consola (DevTools).", "error");
    console.log("matchNames:", names);
    return null;
  }
  if (candidates.length > 1) {
    log(`Varios matchNames coinciden: ${candidates.join(", ")}. Se usa el primero.`, "warn");
  }
  log(`matchName encontrado: "${candidates[0]}"`);
  return candidates[0];
}

btnDiagnose.addEventListener("click", async () => {
  log("— Diagnostico —");
  await findColorLabMatchName();
  await getSelectedVideoClip();
  log("— fin del diagnostico —");
});

btnApply.addEventListener("click", async () => {
  log("— Aplicar —");

  const selected = await getSelectedVideoClip();
  if (!selected.ok) {
    log("Cancelado: no hay un clip de video valido seleccionado.", "error");
    return;
  }
  const { project, trackItem } = selected;

  const matchName = await findColorLabMatchName();
  if (!matchName) {
    log("Cancelado: no se encontro el efecto Color Lab instalado en Premiere.", "error");
    return;
  }

  let lookIndex = Number(lookSelect.value);
  if (!Number.isInteger(lookIndex) || lookIndex < 1 || lookIndex > LOOK_NAMES.length) {
    log(`lookSelect.value es invalido ("${lookSelect.value}"); usando Look=1 (Nature) por defecto. Revisa el desplegable -- puede que no haya quedado una opcion seleccionada.`, "warn");
    lookIndex = 1;
  }
  const intensityValue = Number(intensityInput.value);

  let component, chain, countBefore;
  try {
    component = await premierepro.VideoFilterFactory.createComponent(matchName);
    chain = await trackItem.getComponentChain();
    countBefore = chain.getComponentCount();
  } catch (e) {
    log(`Fallo preparando el componente o la cadena de video: ${e}`, "error");
    return;
  }
  if (!component || !chain) {
    log("createComponent() o getComponentChain() devolvieron vacio.", "error");
    return;
  }

  // Paso 1: solo insertar el efecto. El componente recien creado por
  // VideoFilterFactory (sin insertar todavia) no expone getParamCount/getParam
  // en esta version de Premiere -- lo descubrimos probando este prototipo.
  // Para leer/escribir parametros hay que volver a pedir el componente desde
  // la cadena una vez que ya esta insertado (paso 2).
  let appended = false;
  try {
    project.lockedAccess(() => {
      appended = project.executeTransaction((compoundAction) => {
        compoundAction.addAction(chain.createAppendComponentAction(component));
      }, "Color Lab: insertar efecto");
    });
  } catch (e) {
    log(`Fallo insertando el efecto en la cadena: ${e}`, "error");
    return;
  }
  if (!appended) {
    log("executeTransaction() de insercion devolvio false.", "error");
    return;
  }
  log("Efecto insertado en el clip.");

  // Paso 2: releer el componente ya insertado y escribir Look/Intensity.
  let live;
  try {
    live = chain.getComponentAtIndex(countBefore);
  } catch (e) {
    log(`No se pudo releer el componente insertado (indice ${countBefore}): ${e}`, "error");
    return;
  }
  if (typeof live?.getParamCount !== "function") {
    log("El componente insertado tampoco expone getParamCount() -- el efecto quedo aplicado con sus valores por defecto, pero este prototipo no puede escribir Look/Intensity todavia. Revisa en consola (DevTools) que metodos SI tiene 'live' (console.log(live)).", "error");
    console.log("componente insertado:", live);
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
          const kf = lookParam.createKeyframe(lookIndex);
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
    return;
  }

  if (ok) {
    log(`Look/Intensity aplicados. Look=${lookIndex} (${LOOK_NAMES[lookIndex - 1]}), Intensity=${intensityValue.toFixed(1)}.`);
    log("Verifica en Controles de efectos y prueba Cmd/Ctrl+Z para confirmar el deshacer.");
  } else {
    log("executeTransaction() de parametros devolvio false — revisa la consola (DevTools) para mas detalle.", "error");
  }
});

populateLookDropdown();
log("Panel cargado. Selecciona un clip de video en la linea de tiempo y pulsa Diagnosticar.");
