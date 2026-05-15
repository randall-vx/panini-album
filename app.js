const LOCAL_CACHE_KEY = "panini2026_cache";

const state = {
  session: null,
  profile: null,        // { id, email, apodo, estado, is_admin }
  stickers: {},         // { code: { status, repe, updated_by, updated_at } }
  activity: [],         // [{ code, action, actor_apodo, created_at }]
  quickLoad: false,
  online: false,
  completedTeams: new Set(), // animacion one-shot al completar equipo
  filterComplete: false,
  activeGroup: null,    // letra A-L o null para todos
};

let sb = null;

function initSupabase() {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes("TU_PROYECTO")) {
    showLoginError("Falta configurar Supabase en config.js");
    return false;
  }
  try {
    sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    return true;
  } catch (e) {
    console.error("Error iniciando Supabase:", e);
    showLoginError("Error de conexion con Supabase");
    return false;
  }
}

async function handleAuth() {
  // getSession() recupera la sesion tras el redirect de Google OAuth
  const { data: { session } } = await sb.auth.getSession();

  if (session) {
    state.session = session;
    await loadProfileAndRoute();
  } else {
    showScreen("login-screen");
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session) {
      state.session = session;
      await loadProfileAndRoute();
    } else if (event === "SIGNED_OUT") {
      state.session = null;
      state.profile = null;
      showScreen("login-screen");
    }
  });
}

async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: CONFIG.REDIRECT_URL }
  });
  if (error) {
    showLoginError("No se pudo iniciar sesion: " + error.message);
  }
}

async function signOut() {
  await sb.auth.signOut();
  state.session = null;
  state.profile = null;
  showScreen("login-screen");
}

async function loadProfileAndRoute() {
  const userId = state.session.user.id;

  // El perfil lo crea un trigger en la DB al registrarse; puede no existir aun.
  let profile = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await sb
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.error("Error cargando perfil:", error);
      break;
    }
    if (data) {
      profile = data;
      break;
    }
    await sleep(400);
  }

  if (!profile) {
    showLoginError("No se pudo cargar tu perfil. Proba de nuevo.");
    showScreen("login-screen");
    return;
  }

  state.profile = profile;

  if (profile.estado === "rechazado") {
    document.getElementById("pending-title").textContent = "Acceso denegado";
    document.getElementById("pending-desc").textContent =
      "El administrador no habilito tu acceso a este album.";
    showScreen("pending-screen");
    return;
  }

  if (profile.estado === "pendiente") {
    document.getElementById("pending-title").textContent = "Acceso pendiente";
    document.getElementById("pending-desc").textContent =
      "Tu acceso esta esperando aprobacion. Pedile al administrador del album que te habilite. Volve a entrar mas tarde.";
    showScreen("pending-screen");
    return;
  }

  if (!profile.apodo) {
    showScreen("nick-screen");
    return;
  }

  await enterApp();
}

async function saveNickname() {
  const input = document.getElementById("nick-input");
  const errorEl = document.getElementById("nick-error");
  const apodo = input.value.trim();
  errorEl.textContent = "";

  if (apodo.length < 2) {
    errorEl.textContent = "El apodo necesita al menos 2 letras";
    return;
  }

  const { error } = await sb
    .from("profiles")
    .update({ apodo: apodo })
    .eq("id", state.profile.id);

  if (error) {
    errorEl.textContent = "No se pudo guardar: " + error.message;
    return;
  }

  state.profile.apodo = apodo;
  await enterApp();
}

async function enterApp() {
  showScreen("app");
  document.getElementById("user-tag").textContent = state.profile.apodo.toUpperCase();

  if (state.profile.is_admin) {
    document.body.classList.add("is-admin");
  }

  loadCache();
  renderAll();

  await loadStickers();
  await loadActivity();
  if (state.profile.is_admin) {
    await loadAdminList();
  }

  subscribeRealtime();
  setupPullToRefresh();
  state.online = true;
  flashStatus("Conectado", "ok");
}

async function loadStickers() {
  const { data, error } = await sb.from("stickers").select("*");
  if (error) {
    console.error("Error cargando stickers:", error);
    flashStatus("Error cargando datos", "error");
    return;
  }
  state.stickers = {};
  (data || []).forEach(row => {
    state.stickers[row.code] = {
      status: row.status,
      repe: row.repe,
      updated_by: row.updated_by,
      updated_at: row.updated_at
    };
  });
  saveCache();
  renderAll();
}

async function loadActivity() {
  const { data, error } = await sb
    .from("activity")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("Error cargando actividad:", error);
    return;
  }
  state.activity = data || [];
  renderActivity();
}

async function loadAdminList() {
  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Error cargando perfiles:", error);
    return;
  }
  const profiles = data || [];
  renderAdminList(profiles);
  updateAdminBadge(profiles);
}

let realtimeDisconnected = false;
let realtimeRetryTimer = null;

function subscribeRealtime() {
  sb.channel("stickers-changes")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "stickers" },
      payload => {
        const row = payload.new;
        if (row && row.code) {
          state.stickers[row.code] = {
            status: row.status,
            repe: row.repe,
            updated_by: row.updated_by,
            updated_at: row.updated_at
          };
          saveCache();
          renderAll();
        }
      })
    .subscribe(status => onChannelStatus(status));

  sb.channel("activity-changes")
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "activity" },
      payload => {
        if (payload.new) {
          state.activity.unshift(payload.new);
          state.activity = state.activity.slice(0, 50);
          renderActivity();
          if (payload.new.actor !== state.profile?.id) {
            const apodo = payload.new.actor_apodo || "Alguien";
            const action = payload.new.action;
            let msg = `${apodo}: `;
            if (action === "pegada") msg += `pegó ${payload.new.code}`;
            else if (action === "falta") msg += `quitó ${payload.new.code}`;
            else msg += `repe ${payload.new.code}`;
            showToast(msg);
          }
        }
      })
    .subscribe();
}

function onChannelStatus(status) {
  if (status === "SUBSCRIBED") {
    if (realtimeDisconnected) {
      // Reconectado tras una caida: recupera eventos que pudieron perderse.
      realtimeDisconnected = false;
      clearTimeout(realtimeRetryTimer);
      showToast("Sincronizado");
      loadStickers();
    }
  } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
    if (!realtimeDisconnected) {
      realtimeDisconnected = true;
      showToast("Reconectando...");
    }
    // Reintenta suscripcion cada 5s mientras siga desconectado.
    clearTimeout(realtimeRetryTimer);
    realtimeRetryTimer = setTimeout(() => {
      sb.removeAllChannels();
      subscribeRealtime();
    }, 5000);
  }
}

// Cache local: solo lectura rapida al inicio, no es fuente de verdad.
function saveCache() {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ stickers: state.stickers }));
  } catch (e) { /* private mode / quota */ }
}

function loadCache() {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.stickers = parsed.stickers || {};
    }
  } catch (e) { /* ignore */ }
}

function getStickerState(code) {
  return state.stickers[code] || { status: "falta", repe: 0 };
}

function renderAll() {
  renderGroupSelector();
  renderGrid();
  renderProgress();
  renderFaltantes();
  renderRepetidas();
}

function renderProgress() {
  const total = ALL_STICKERS.length;
  let pegadas = 0;
  ALL_STICKERS.forEach(s => {
    const st = getStickerState(s.code);
    if (st.status === "pegada" || st.status === "repe") pegadas++;
  });
  document.getElementById("progress-count").textContent = pegadas;
  document.getElementById("progress-total").textContent = total;
  const pct = total ? (pegadas / total) * 100 : 0;
  document.getElementById("progress-fill").style.width = pct + "%";
}

function renderTeamsIndex() {
  const container = document.getElementById("teams-index");
  if (!container) return;

  let blocks = GRID_BLOCKS;
  if (state.activeGroup) {
    const group = GROUPS.find(g => g.letter === state.activeGroup);
    if (group) blocks = GRID_BLOCKS.filter(b => group.teams.includes(b.code));
  }

  container.innerHTML = blocks.map(block => {
    let pegadas = 0;
    block.stickers.forEach(s => { if (getStickerState(s.code).status !== "falta") pegadas++; });
    const cls = pegadas === block.stickers.length ? "index-chip complete" : "index-chip";
    return `<button class="${cls}" data-code="${block.code}">${block.code}</button>`;
  }).join("");

  container.querySelectorAll(".index-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const target = document.querySelector(`.team-block[data-code="${chip.dataset.code}"]`);
      if (!target) return;
      const stickyBottom = container.getBoundingClientRect().bottom;
      const y = target.getBoundingClientRect().top + window.scrollY - stickyBottom - 8;
      window.scrollTo({ top: y, behavior: "smooth" });
    });
  });
}

function renderGroupSelector() {
  const container = document.getElementById("groups-selector");
  if (!container) return;

  const chips = [
    `<button class="grp-chip${state.activeGroup === null ? " active" : ""}" data-group="">Ver todos</button>`
  ];

  GROUPS.forEach(group => {
    let pegadas = 0, total = 0;
    group.teams.forEach(teamCode => {
      const block = GRID_BLOCKS.find(b => b.code === teamCode);
      if (!block) return;
      block.stickers.forEach(s => {
        total++;
        if (getStickerState(s.code).status !== "falta") pegadas++;
      });
    });
    const pct = total > 0 ? Math.round((pegadas / total) * 100) : 0;
    const isActive = state.activeGroup === group.letter;
    const isComplete = pct === 100;
    const cls = `grp-chip${isActive ? " active" : ""}${isComplete ? " complete" : ""}`;
    chips.push(`
      <button class="${cls}" data-group="${group.letter}">
        <span class="grp-letter">Grupo ${group.letter}</span>
        <span class="grp-pct">${pct}%</span>
      </button>
    `);
  });

  container.innerHTML = chips.join("");

  container.querySelectorAll(".grp-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      haptic();
      const letter = chip.dataset.group;
      state.activeGroup = letter || null;
      renderAll();
      if (state.activeGroup) {
        setTimeout(() => {
          const firstBlock = document.querySelector(".team-block");
          const teamsIndex = document.getElementById("teams-index");
          if (firstBlock && teamsIndex) {
            const stickyBottom = teamsIndex.getBoundingClientRect().bottom;
            const y = firstBlock.getBoundingClientRect().top + window.scrollY - stickyBottom - 8;
            window.scrollTo({ top: y, behavior: "smooth" });
          }
        }, 50);
      }
    });
  });
}

function renderGrid() {
  const scrollY = window.scrollY;
  const container = document.getElementById("teams-grid");
  const html = [];

  const activeGroupObj = state.activeGroup
    ? GROUPS.find(g => g.letter === state.activeGroup)
    : null;

  GRID_BLOCKS.forEach(block => {
    if (activeGroupObj && !activeGroupObj.teams.includes(block.code)) return;
    const stickers = [];
    let pegadas = 0;
    const total = block.stickers.length;

    block.stickers.forEach(s => {
      const st = getStickerState(s.code);
      if (st.status !== "falta") pegadas++;
      const cls = st.status === "pegada" ? "pegada" :
                  st.status === "repe" ? "repe" : "";
      const repeAttr = st.status === "repe" && st.repe > 0 ?
                      `data-repe="${st.repe}"` : "";
      const label = s.num === 0 ? "00" : s.num;
      stickers.push(
        `<div class="sticker ${cls}" data-code="${s.code}" ${repeAttr}>${label}</div>`
      );
    });

    const isComplete = pegadas === total;
    if (state.filterComplete && isComplete) return;

    const wasComplete = state.completedTeams.has(block.code);
    let blockCls = "team-block";
    if (isComplete) {
      blockCls += wasComplete ? " complete" : " complete newly-complete";
      state.completedTeams.add(block.code);
    }

    const progressSpanCls = isComplete ? "complete" : "";
    const pct = total > 0 ? (pegadas / total) * 100 : 0;
    const gridClass = state.quickLoad ? "stickers-grid quickload" : "stickers-grid";
    html.push(`
      <div class="${blockCls}" data-code="${block.code}">
        <div class="team-header">
          <div class="team-name">${block.name}</div>
          <div class="team-progress"><span class="${progressSpanCls}">${pegadas}</span>/${total}</div>
        </div>
        <div class="team-progress-bar-wrap">
          <div class="team-progress-bar" style="width:${pct}%"></div>
        </div>
        <div class="${gridClass}">${stickers.join("")}</div>
      </div>
    `);
  });

  container.innerHTML = html.join("");
  renderTeamsIndex();
  if (scrollY > 0) requestAnimationFrame(() => window.scrollTo(0, scrollY));

  container.querySelectorAll(".sticker").forEach(el => {
    el.addEventListener("click", () => {
      haptic();
      if (state.quickLoad) {
        quickToggle(el.dataset.code);
      } else {
        openStickerModal(el.dataset.code);
      }
    });
  });
}

function quickToggle(code) {
  const st = getStickerState(code);
  if (st.status === "falta") {
    updateSticker(code, { status: "pegada", repe: st.repe || 0 }, "pegada");
  } else {
    updateSticker(code, { status: "falta", repe: 0 }, "falta");
  }
}

function renderFaltantes() {
  const container = document.getElementById("falt-list");
  let total = 0;
  const html = [];

  GRID_BLOCKS.forEach(block => {
    const faltan = block.stickers.filter(
      s => getStickerState(s.code).status === "falta"
    );
    if (faltan.length === 0) return;
    total += faltan.length;
    const chips = faltan
      .map(s => `<span class="group-chip">${s.code}</span>`)
      .join("");
    html.push(`
      <div class="group-row">
        <div class="group-name">${block.name} <span class="group-count">${faltan.length}</span></div>
        <div class="group-chips">${chips}</div>
      </div>
    `);
  });

  document.getElementById("falt-count").textContent = total;

  if (total === 0) {
    container.innerHTML = '<div class="empty-state">Album completo! No falta ninguna.</div>';
    return;
  }
  container.innerHTML = html.join("");
}

function renderRepetidas() {
  const container = document.getElementById("repe-list");
  let totalStickers = 0;
  const groups = [];

  GRID_BLOCKS.forEach(block => {
    const repes = block.stickers
      .map(s => ({ ...s, st: getStickerState(s.code) }))
      .filter(s => s.st.status === "repe" && s.st.repe > 0);
    if (repes.length === 0) return;
    const blockTotal = repes.reduce((sum, s) => sum + s.st.repe, 0);
    groups.push({ block, repes, blockTotal });
  });

  const html = groups.map(({ block, repes, blockTotal }) => {
    totalStickers += blockTotal;
    const chips = repes.map(s => `
      <span class="group-chip repe">
        ${s.code}<span class="repe-badge">x${s.st.repe}</span><button class="repe-chip-minus" data-code="${s.code}" aria-label="Quitar una">−</button>
      </span>`).join("");
    return `
      <div class="group-row">
        <div class="group-name">${block.name} <span class="group-count">${blockTotal}</span></div>
        <div class="group-chips">${chips}</div>
      </div>`;
  });

  document.getElementById("repe-count").textContent = totalStickers;

  if (totalStickers === 0) {
    container.innerHTML = '<div class="empty-state">No hay repetidas para tradear todavia.</div>';
    return;
  }
  container.innerHTML = html.join("");
}

function renderActivity() {
  const container = document.getElementById("activity-list");
  if (state.activity.length === 0) {
    container.innerHTML = '<div class="empty-state">Sin movimientos todavia.</div>';
    return;
  }
  container.innerHTML = state.activity.slice(0, 50).map(a => {
    const apodo = a.actor_apodo || "Alguien";
    const initial = apodo.charAt(0).toUpperCase();
    let action = "";
    if (a.action === "pegada") action = `marco <code>${a.code}</code> como <strong>pegada</strong>`;
    else if (a.action === "falta") action = `marco <code>${a.code}</code> como <strong>falta</strong>`;
    else if (a.action === "repe") action = `actualizo repes de <code>${a.code}</code>`;
    else action = `cambio <code>${a.code}</code>`;
    return `
      <div class="activity-item">
        <div class="activity-who">${initial}</div>
        <div class="activity-text"><strong>${escapeHtml(apodo)}</strong> ${action}</div>
        <div class="activity-time">${formatTime(a.created_at)}</div>
      </div>
    `;
  }).join("");
}

function renderAdminList(profiles) {
  const container = document.getElementById("admin-list");
  if (!profiles || profiles.length === 0) {
    container.innerHTML = '<div class="empty-state">Sin usuarios.</div>';
    return;
  }
  container.innerHTML = profiles.map(p => {
    const isSelf = p.id === state.profile.id;
    const apodo = p.apodo || "(sin apodo)";
    let badge = "";
    if (p.estado === "aprobado") badge = '<span class="badge ok">Aprobado</span>';
    else if (p.estado === "pendiente") badge = '<span class="badge pending">Pendiente</span>';
    else badge = '<span class="badge rejected">Rechazado</span>';
    if (p.is_admin) badge += ' <span class="badge admin">Admin</span>';

    let actions = "";
    if (!isSelf) {
      if (p.estado === "pendiente") {
        actions = `
          <button class="admin-btn approve" data-id="${p.id}" data-action="aprobar">Aprobar</button>
          <button class="admin-btn reject" data-id="${p.id}" data-action="rechazar">Rechazar</button>
        `;
      } else if (p.estado === "aprobado") {
        actions = `<button class="admin-btn reject" data-id="${p.id}" data-action="rechazar">Quitar acceso</button>`;
      } else if (p.estado === "rechazado") {
        actions = `<button class="admin-btn approve" data-id="${p.id}" data-action="aprobar">Aprobar</button>`;
      }
    } else {
      actions = '<span class="admin-self">Vos</span>';
    }

    return `
      <div class="admin-item">
        <div class="admin-info">
          <div class="admin-name">${escapeHtml(apodo)}</div>
          <div class="admin-email">${escapeHtml(p.email)}</div>
          <div class="admin-badges">${badge}</div>
        </div>
        <div class="admin-actions">${actions}</div>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".admin-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      handleAdminAction(btn.dataset.id, btn.dataset.action);
    });
  });
}

async function handleAdminAction(profileId, action) {
  const nuevoEstado = action === "aprobar" ? "aprobado" : "rechazado";
  const { error } = await sb
    .from("profiles")
    .update({ estado: nuevoEstado })
    .eq("id", profileId);
  if (error) {
    flashStatus("No se pudo actualizar: " + error.message, "error");
    return;
  }
  flashStatus(action === "aprobar" ? "Usuario aprobado" : "Acceso quitado", "ok");
  await loadAdminList();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return diffMin + "m";
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + "h";
  return d.getDate() + "/" + (d.getMonth() + 1);
}

let currentCode = null;

function openStickerModal(code) {
  haptic();
  currentCode = code;
  const sticker = ALL_STICKERS.find(s => s.code === code);
  const st = getStickerState(code);

  document.getElementById("modal-code").textContent = code;
  document.getElementById("modal-meta").textContent =
    sticker ? (sticker.num > 0 ? `${sticker.teamName} · #${sticker.num}` : sticker.teamName) : "";
  document.getElementById("modal-repe-count").textContent = st.repe || 0;

  document.querySelectorAll(".modal-btn").forEach(b => b.classList.remove("current"));
  if (st.status === "falta") {
    document.querySelector(".modal-btn.falta").classList.add("current");
  } else if (st.status === "pegada") {
    document.querySelector(".modal-btn.pegada").classList.add("current");
  }

  document.getElementById("modal-backdrop").classList.add("show");
}

function closeModal() {
  const backdrop = document.getElementById("modal-backdrop");
  backdrop.classList.add("closing");
  setTimeout(() => {
    backdrop.classList.remove("show", "closing");
    currentCode = null;
  }, 250);
}

function setupModal() {
  document.getElementById("modal-backdrop").addEventListener("click", e => {
    if (e.target.id === "modal-backdrop") closeModal();
  });

  document.querySelectorAll(".modal-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!currentCode) return;
      const action = btn.dataset.action;
      const st = getStickerState(currentCode);
      updateSticker(currentCode, {
        status: action,
        repe: action === "repe" ? (st.repe || 1) : (action === "pegada" ? st.repe : 0)
      }, action);
      document.querySelectorAll(".modal-btn").forEach(b => b.classList.remove("current"));
      btn.classList.add("current");
      setTimeout(closeModal, 150);
    });
  });

  document.querySelectorAll(".repe-step").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!currentCode) return;
      const st = getStickerState(currentCode);
      const step = parseInt(btn.dataset.step, 10);
      let newRepe = Math.max(0, (st.repe || 0) + step);
      let newStatus = st.status;
      if (newRepe > 0) {
        newStatus = "repe";
      } else if (st.status === "repe") {
        newStatus = "pegada";
      }
      updateSticker(currentCode, { status: newStatus, repe: newRepe }, "repe");
      document.getElementById("modal-repe-count").textContent = newRepe;
      document.querySelectorAll(".modal-btn").forEach(b => b.classList.remove("current"));
      if (newStatus === "pegada") {
        document.querySelector(".modal-btn.pegada").classList.add("current");
      } else if (newStatus === "falta") {
        document.querySelector(".modal-btn.falta").classList.add("current");
      }
    });
  });
}

async function updateSticker(code, changes, action) {
  const now = new Date().toISOString();
  const updated = {
    status: changes.status,
    repe: changes.repe || 0,
    updated_by: state.profile.id,
    updated_at: now
  };

  // Guarda el estado anterior para revertir si falla.
  const prev = state.stickers[code];

  // Optimistic update: refleja el cambio antes de confirmar con el servidor.
  state.stickers[code] = updated;
  saveCache();
  renderAll();

  const { data, error } = await sb
    .from("stickers")
    .upsert({ code: code, ...updated }, { onConflict: "code" })
    .select();

  if (error) {
    console.error("[updateSticker] Error al guardar:", code, error);
    // Revierte el optimistic update para que la UI refleje el estado real.
    if (prev) {
      state.stickers[code] = prev;
    } else {
      delete state.stickers[code];
    }
    saveCache();
    renderAll();
    flashStatus("Error al guardar: " + error.message, "error");
    return;
  }

  if (!data || data.length === 0) {
    console.warn("[updateSticker] Upsert sin efecto (RLS?):", code);
    if (prev) {
      state.stickers[code] = prev;
    } else {
      delete state.stickers[code];
    }
    saveCache();
    renderAll();
    flashStatus("No se pudo guardar - sin permisos", "error");
    return;
  }

  // En modo carga rapida se omite el log para no saturar la tabla activity.
  if (!state.quickLoad) {
    await sb.from("activity").insert({
      code: code,
      action: action,
      actor: state.profile.id,
      actor_apodo: state.profile.apodo
    });
  }
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
      window.scrollTo(0, 0);
    });
  });
}

function setupQuickLoad() {
  const btn = document.getElementById("quickload-toggle");
  const banner = document.getElementById("quickload-banner");
  btn.addEventListener("click", () => {
    if (!state.quickLoad) {
      const ok = confirm(
        "Modo carga rapida\n\n" +
        "Cada tap va a marcar la figurita al instante, sin pedir confirmacion. " +
        "Sirve para cargar la planilla de papel rapido.\n\n" +
        "Activar?"
      );
      if (!ok) return;
    }
    state.quickLoad = !state.quickLoad;
    btn.classList.toggle("active", state.quickLoad);
    banner.classList.toggle("show", state.quickLoad);
    renderGrid();
  });
}

function setupShare() {
  document.getElementById("share-falt").addEventListener("click", () => {
    let total = 0;
    const sections = [];

    const fmt = (code, teamCode) => code.replace(teamCode, "");
    const fmtSpecial = code => code;

    const faltMap = {};
    GRID_BLOCKS.forEach(block => {
      const faltan = block.stickers.filter(s => getStickerState(s.code).status === "falta");
      if (faltan.length > 0) {
        faltMap[block.code] = { block, faltan };
        total += faltan.length;
      }
    });

    if (faltMap["FWC"]) {
      const chips = faltMap["FWC"].faltan.map(s => fmtSpecial(s.code)).join(", ");
      sections.push(`⚽ MUNDIAL (intro)\n${chips}`);
    }

    GROUPS.forEach(group => {
      const teamLines = [];
      group.teams.forEach(teamCode => {
        if (!faltMap[teamCode]) return;
        const chips = faltMap[teamCode].faltan.map(s => fmt(s.code, teamCode)).join(", ");
        teamLines.push(`${teamCode}: ${chips}`);
      });
      if (teamLines.length === 0) return;
      sections.push(`🌍 GRUPO ${group.letter}\n${teamLines.join(" · ")}`);
    });

    if (faltMap["FWC2"]) {
      const chips = faltMap["FWC2"].faltan.map(s => fmtSpecial(s.code)).join(", ");
      sections.push(`⚽ MUNDIAL (cierre)\n${chips}`);
    }

    if (faltMap["CC"]) {
      const chips = faltMap["CC"].faltan.map(s => fmtSpecial(s.code)).join(", ");
      sections.push(`🥤 COCA-COLA\n${chips}`);
    }

    const text = `📋 Panini FIFA 2026 - Me faltan (${total})\n\n` + sections.join("\n\n");
    shareText(text);
  });

  document.getElementById("share-repe").addEventListener("click", () => {
    let total = 0;
    const sections = [];

    // Devuelve "N" o "N×K" (sin prefijo de equipo, sin ×1)
    const fmt = (code, teamCode, count) => {
      const num = code.replace(teamCode, "");
      return count > 1 ? `${num}×${count}` : num;
    };
    // Para bloques especiales (FWC, CC) conserva el codigo completo
    const fmtSpecial = (code, count) => count > 1 ? `${code}×${count}` : code;

    // Construye mapa blockCode → repes para acceso rápido
    const repeMap = {};
    GRID_BLOCKS.forEach(block => {
      const repes = block.stickers
        .map(s => ({ ...s, st: getStickerState(s.code) }))
        .filter(s => s.st.status === "repe" && s.st.repe > 0);
      if (repes.length > 0) {
        repeMap[block.code] = { block, repes };
        total += repes.reduce((sum, s) => sum + s.st.repe, 0);
      }
    });

    // FWC intro
    if (repeMap["FWC"]) {
      const chips = repeMap["FWC"].repes.map(s => fmtSpecial(s.code, s.st.repe)).join(", ");
      sections.push(`⚽ MUNDIAL (intro)\n${chips}`);
    }

    // Grupos A–L
    GROUPS.forEach(group => {
      const teamLines = [];
      group.teams.forEach(teamCode => {
        if (!repeMap[teamCode]) return;
        const chips = repeMap[teamCode].repes.map(s => fmt(s.code, teamCode, s.st.repe)).join(", ");
        teamLines.push(`${teamCode}: ${chips}`);
      });
      if (teamLines.length === 0) return;
      sections.push(`🌍 GRUPO ${group.letter}\n${teamLines.join(" · ")}`);
    });

    // FWC cierre
    if (repeMap["FWC2"]) {
      const chips = repeMap["FWC2"].repes.map(s => fmtSpecial(s.code, s.st.repe)).join(", ");
      sections.push(`⚽ MUNDIAL (cierre)\n${chips}`);
    }

    // Coca-Cola
    if (repeMap["CC"]) {
      const chips = repeMap["CC"].repes.map(s => fmtSpecial(s.code, s.st.repe)).join(", ");
      sections.push(`🥤 COCA-COLA\n${chips}`);
    }

    const text = `📋 Panini FIFA 2026 - Tradeo (${total})\n\n` + sections.join("\n\n");
    shareText(text);
  });
}

function shareText(text) {
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      flashStatus("Copiado al portapapeles", "ok");
    });
  } else {
    alert(text);
  }
}

function setupExport() {
  document.getElementById("export-btn").addEventListener("click", () => {
    const backup = {
      exported_at: new Date().toISOString(),
      exported_by: state.profile.apodo,
      total_stickers: ALL_STICKERS.length,
      stickers: {}
    };
    ALL_STICKERS.forEach(s => {
      const st = getStickerState(s.code);
      if (st.status !== "falta") {
        backup.stickers[s.code] = { status: st.status, repe: st.repe || 0 };
      }
    });

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fecha = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `respaldo-album-panini-${fecha}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    flashStatus("Respaldo descargado", "ok");
  });
}

function setupLogout() {
  document.getElementById("logout-btn").addEventListener("click", () => {
    if (confirm("Salir de la sesion?")) {
      signOut();
    }
  });
  document.getElementById("pending-logout").addEventListener("click", () => {
    signOut();
  });
}

let statusTimer = null;
function flashStatus(text, kind) {
  const el = document.getElementById("connection-status");
  el.textContent = text;
  el.className = "conn-status show " + (kind || "");
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 2500);
}

function haptic(ms = 8) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

let toastTimer = null;
function showToast(text) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

function updateAdminBadge(profiles) {
  const pending = (profiles || []).filter(
    p => p.estado === "pendiente" && p.id !== state.profile?.id
  ).length;
  const tab = document.getElementById("admin-tab");
  if (!tab) return;
  let dot = tab.querySelector(".admin-badge");
  if (pending > 0) {
    if (!dot) { dot = document.createElement("span"); dot.className = "admin-badge"; tab.appendChild(dot); }
    dot.textContent = pending;
  } else if (dot) {
    dot.remove();
  }
}

function setupPullToRefresh() {
  let startY = 0, triggered = false;
  const indicator = document.getElementById("ptr-indicator");

  const reset = () => {
    indicator.classList.remove("show", "ready", "loading");
    triggered = false;
  };

  document.addEventListener("touchstart", e => {
    startY = e.touches[0].clientY;
    triggered = false;
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (window.scrollY > 5) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 65) {
      triggered = true;
      indicator.classList.add("show", "ready");
    } else if (dy > 15) {
      indicator.classList.add("show");
      indicator.classList.remove("ready");
    } else {
      indicator.classList.remove("show", "ready");
    }
  }, { passive: true });

  document.addEventListener("touchend", async () => {
    if (!triggered) { reset(); return; }
    indicator.classList.remove("ready");
    indicator.classList.add("loading");
    await Promise.all([loadStickers(), loadActivity()]);
    reset();
  });

  document.addEventListener("touchcancel", reset);
}

function setupFilterComplete() {
  const btn = document.getElementById("filter-complete-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    state.filterComplete = !state.filterComplete;
    btn.classList.toggle("active", state.filterComplete);
    btn.textContent = state.filterComplete ? "Ver todos" : "Ocultar completos";
    renderGrid();
  });
}

function setupSearch() {
  const btn = document.getElementById("search-btn");
  const overlay = document.getElementById("search-overlay");
  const input = document.getElementById("search-input");
  const closeBtn = document.getElementById("search-close");
  const results = document.getElementById("search-results");

  btn.addEventListener("click", () => {
    overlay.classList.add("show");
    input.value = "";
    results.innerHTML = '<div class="search-empty">Ingresa un codigo de figurita</div>';
    setTimeout(() => input.focus(), 120);
  });

  closeBtn.addEventListener("click", closeSearch);
  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeSearch();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeSearch();
  });

  input.addEventListener("input", () => {
    const query = input.value.trim().toUpperCase();
    renderSearchResults(query, results);
  });
}

function closeSearch() {
  document.getElementById("search-overlay").classList.remove("show");
}

function renderSearchResults(query, container) {
  if (!query) {
    container.innerHTML = '<div class="search-empty">Ingresa un codigo de figurita</div>';
    return;
  }

  const matches = ALL_STICKERS.filter(s => s.code.toUpperCase().startsWith(query));

  if (matches.length === 0) {
    container.innerHTML = '<div class="search-empty">No se encontro ninguna figurita</div>';
    return;
  }

  container.innerHTML = matches.slice(0, 40).map(s => {
    const st = getStickerState(s.code);
    const label = st.status === "repe" ? `Repe x${st.repe || 1}` :
                  st.status === "pegada" ? "Pegada" : "Falta";
    return `
      <div class="search-result-item" data-code="${s.code}">
        <div class="search-result-left">
          <div class="search-result-code">${s.code}</div>
          <div class="search-result-team">${escapeHtml(s.teamName)}</div>
        </div>
        <div class="search-result-status ${st.status}">${label}</div>
      </div>`;
  }).join("");

  container.querySelectorAll(".search-result-item").forEach(item => {
    item.addEventListener("click", () => {
      closeSearch();
      openStickerModal(item.dataset.code);
    });
  });
}

function setupRepeChipMinus() {
  document.getElementById("repe-list").addEventListener("click", e => {
    const btn = e.target.closest(".repe-chip-minus");
    if (!btn) return;
    haptic();
    const code = btn.dataset.code;
    const st = getStickerState(code);
    const newRepe = Math.max(0, (st.repe || 0) - 1);
    updateSticker(code, { status: newRepe > 0 ? "repe" : "pegada", repe: newRepe }, "repe");
  });
}

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

function showLoginError(msg) {
  const el = document.getElementById("login-error");
  if (el) el.textContent = msg;
}

function init() {
  document.getElementById("google-login").addEventListener("click", signInWithGoogle);
  document.getElementById("nick-save").addEventListener("click", saveNickname);
  document.getElementById("nick-input").addEventListener("keydown", e => {
    if (e.key === "Enter") saveNickname();
  });

  setupTabs();
  setupQuickLoad();
  setupModal();
  setupShare();
  setupExport();
  setupLogout();
  setupFilterComplete();
  setupRepeChipMinus();
  setupSearch();

  if (!initSupabase()) {
    showScreen("login-screen");
    return;
  }
  handleAuth();
}

document.addEventListener("DOMContentLoaded", init);
