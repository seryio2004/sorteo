import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const els = {
  heroMessage: document.querySelector("#heroMessage"),
  statusPill: document.querySelector("#statusPill"),
  countdown: document.querySelector("#countdown"),
  drawDate: document.querySelector("#drawDate"),
  participantsCount: document.querySelector("#participantsCount"),
  registrationStatus: document.querySelector("#registrationStatus"),
  drawTime: document.querySelector("#drawTime"),
  entryForm: document.querySelector("#entryForm"),
  nameInput: document.querySelector("#nameInput"),
  submitButton: document.querySelector("#submitButton"),
  formMessage: document.querySelector("#formMessage"),
  registeredTicket: document.querySelector("#registeredTicket"),
  registeredName: document.querySelector("#registeredName"),
  winnerSection: document.querySelector("#winnerSection"),
  winnerName: document.querySelector("#winnerName"),
  lastUpdate: document.querySelector("#lastUpdate"),
  openQrButton: document.querySelector("#openQrButton"),
  qrDialog: document.querySelector("#qrDialog"),
  qrCode: document.querySelector("#qrCode"),
  qrUrl: document.querySelector("#qrUrl"),
};

const isConfigured =
  SUPABASE_URL &&
  SUPABASE_PUBLISHABLE_KEY &&
  !SUPABASE_URL.includes("TU-PROYECTO") &&
  !SUPABASE_PUBLISHABLE_KEY.includes("TU_PUBLISHABLE_KEY");

const client = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

let state = null;
let countdownTimer = null;
let scheduledDrawTimer = null;

function getOrCreateDeviceId() {
  const key = "raffle_device_id";
  let id = localStorage.getItem(key);

  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }

  return id;
}

function getStoredName() {
  return localStorage.getItem("raffle_registered_name");
}

function saveStoredName(name) {
  localStorage.setItem("raffle_registered_name", name);
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function setFormMessage(message = "", kind = "") {
  els.formMessage.textContent = message;
  els.formMessage.dataset.state = kind;
  els.nameInput.setAttribute("aria-invalid", String(kind === "error"));
}

function setRegisteredUI(name) {
  els.entryForm.hidden = true;
  els.entryForm.removeAttribute("aria-busy");
  els.registeredName.textContent = name;
  els.registeredTicket.classList.remove("ticket--hidden");
}

function setUnregisteredUI() {
  els.entryForm.hidden = false;
  els.registeredTicket.classList.add("ticket--hidden");
}

function updateCountdown() {
  if (!state?.draw_at) {
    els.countdown.textContent = "--:--:--";
    return;
  }

  const now = Date.now();
  const target = new Date(state.draw_at).getTime();
  const diff = Math.max(0, target - now);

  if (diff <= 0) {
    els.countdown.textContent = "00:00:00";
    return;
  }

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  els.countdown.textContent = days > 0
    ? `${days}d ${hh}:${mm}:${ss}`
    : `${hh}:${mm}:${ss}`;
}

function configureDrawTimer() {
  clearTimeout(scheduledDrawTimer);

  if (!state?.draw_at) return;

  const delay = new Date(state.draw_at).getTime() - Date.now();

  if (delay <= 0) {
    drawIfDue();
    return;
  }

  // setTimeout tiene un límite práctico de ~24,8 días.
  const safeDelay = Math.min(delay + 250, 2_000_000_000);

  scheduledDrawTimer = setTimeout(async () => {
    if (delay > 2_000_000_000) {
      configureDrawTimer();
      return;
    }
    await drawIfDue();
  }, safeDelay);
}

function renderState() {
  if (!state) return;

  const now = new Date();
  const opensAt = state.registration_opens_at ? new Date(state.registration_opens_at) : null;
  const closesAt = state.registration_closes_at ? new Date(state.registration_closes_at) : null;
  const drawAt = state.draw_at ? new Date(state.draw_at) : null;

  document.title = "Botella de Licorca";

  els.participantsCount.textContent = state.entries_count ?? 0;
  els.drawDate.textContent = drawAt ? formatDateTime(drawAt) : "Fecha sin configurar";
  els.drawTime.textContent = drawAt ? formatTime(drawAt) : "—";

  const isBeforeOpen = opensAt && now < opensAt;
  const isOpen = (!opensAt || now >= opensAt) && (!closesAt || now < closesAt) && !state.winner_name;
  const isClosed = closesAt && now >= closesAt;

  if (state.winner_name) {
    els.statusPill.textContent = "Sorteo finalizado";
    els.statusPill.dataset.state = "closed";
    els.registrationStatus.textContent = "Cerrada";
    els.winnerName.textContent = state.winner_name;
    els.winnerSection.classList.remove("winner-panel--hidden");
    els.heroMessage.textContent = "Resultado listo.";
  } else {
    els.winnerSection.classList.add("winner-panel--hidden");

    if (isBeforeOpen) {
      els.statusPill.textContent = "Próximamente";
      els.statusPill.dataset.state = "closed";
      els.registrationStatus.textContent = `Abre ${formatDateTime(opensAt)}`;
      els.heroMessage.textContent = "Próximamente.";
    } else if (isOpen) {
      els.statusPill.textContent = "Inscripción abierta";
      els.statusPill.dataset.state = "open";
      els.registrationStatus.textContent = closesAt ? `Hasta ${formatTime(closesAt)}` : "Abierta";
      els.heroMessage.textContent = "";
    } else if (isClosed || (drawAt && now >= drawAt)) {
      els.statusPill.textContent = "Inscripción cerrada";
      els.statusPill.dataset.state = "closed";
      els.registrationStatus.textContent = "Cerrada";
      els.heroMessage.textContent = drawAt && now < drawAt ? "Inscripción cerrada." : "Sorteando.";
    }
  }

  const registeredName = getStoredName();
  if (registeredName) {
    setRegisteredUI(registeredName);
  } else if (isOpen) {
    setUnregisteredUI();
    els.submitButton.disabled = false;
    els.nameInput.disabled = false;
  } else {
    setUnregisteredUI();
    els.submitButton.disabled = true;
    els.nameInput.disabled = true;
  }

  els.lastUpdate.textContent = new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());

  updateCountdown();
}

async function loadState() {
  if (!client) {
    els.statusPill.textContent = "Falta configurar Supabase";
    els.statusPill.dataset.state = "closed";
    els.heroMessage.textContent = "Sin conexión.";
    els.submitButton.disabled = true;
    els.participantsCount.textContent = "—";
    return;
  }

  const { data, error } = await client.rpc("get_public_state");

  if (error) {
    console.error(error);
    els.statusPill.textContent = "Error de conexión";
    els.statusPill.dataset.state = "closed";
    setFormMessage("No se ha podido conectar con el sorteo.", "error");
    return;
  }

  state = data;
  renderState();
  configureDrawTimer();
}

async function drawIfDue() {
  if (!client) return;

  const { error } = await client.rpc("draw_if_due");
  if (error) {
    console.error("draw_if_due:", error);
  }

  await loadState();
}

els.entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!client) return;

  const name = els.nameInput.value.trim();

  if (name.length < 2 || name.length > 60) {
    setFormMessage("Introduce un nombre de entre 2 y 60 caracteres.", "error");
    els.nameInput.focus();
    return;
  }

  els.submitButton.disabled = true;
  els.nameInput.disabled = true;
  els.entryForm.setAttribute("aria-busy", "true");
  setFormMessage("Entrando…");

  const { data, error } = await client.rpc("register_entry", {
    p_name: name,
    p_device_id: getOrCreateDeviceId(),
  });

  if (error) {
    console.error(error);
    setFormMessage(error.message || "No se ha podido registrar la papeleta.", "error");
    els.submitButton.disabled = false;
    els.nameInput.disabled = false;
    els.entryForm.removeAttribute("aria-busy");
    return;
  }

  const savedName = data?.name || name;
  saveStoredName(savedName);
  setRegisteredUI(savedName);
  setFormMessage("", "success");
  await loadState();
});

els.nameInput.addEventListener("input", () => {
  if (els.formMessage.dataset.state === "error") {
    setFormMessage();
  }
});

els.openQrButton.addEventListener("click", () => {
  const url = new URL("./", window.location.href).href;
  els.qrUrl.textContent = url;
  els.qrCode.innerHTML = "";

  if (window.QRCode) {
    new QRCode(els.qrCode, {
      text: url,
      width: 198,
      height: 198,
      colorDark: "#0e0b12",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H,
    });
  } else {
    els.qrCode.textContent = "No se pudo generar el QR.";
  }

  els.qrDialog.showModal();
});

countdownTimer = setInterval(updateCountdown, 1000);

// Refresca participantes/resultado. Si ya ha llegado la hora, el propio cliente
// puede activar el sorteo; la función SQL impide ejecutarlo antes de tiempo.
setInterval(async () => {
  if (state?.draw_at && new Date(state.draw_at).getTime() <= Date.now() && !state?.winner_name) {
    await drawIfDue();
  } else {
    await loadState();
  }
}, 10000);

await loadState();
