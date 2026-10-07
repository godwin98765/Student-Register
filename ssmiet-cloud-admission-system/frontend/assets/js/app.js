/* ==========================================================================
   SSM IET CLOUD ADMISSION PORTAL — CORE APPLICATION LOGIC
   Direct AWS Integration: API Gateway, S3, DynamoDB, Amazon Cognito Hosted UI (PKCE)
   ========================================================================== */

/* ===== Global Constants & DOM Utilities ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TOK = "ssmiet_token";
const TOK_ID = "ssmiet_id_token";
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt = d => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch (_) {
    return String(d);
  }
};
const wait = ms => new Promise(r => setTimeout(r, ms));

/* Admission Workflow & Document Definitions */
const FLOW = ["Submitted", "Under Review", "Documents Verified", "Callback Required", "Student Contacted", "Confirmed"];
const ALL_STATUS = [...FLOW, "Correction Requested", "Rejected"];
const DOCS = [
  ["photo", "Passport-size photo", 1],
  ["id", "Government ID proof", 1],
  ["marks", "Previous mark sheets", 1],
  ["tc", "Transfer certificate", 0]
]; // [key, label, required]

/* ===== Config Helpers ===== */
function isMockMode() {
  return typeof MOCK_MODE !== "undefined" ? Boolean(MOCK_MODE) : false;
}

function getApiBaseUrl() {
  const u = typeof API_BASE_URL !== "undefined" ? String(API_BASE_URL).trim() : "";
  return u.replace(/\/+$/, "");
}

function getCognitoDomain() {
  const d = typeof COGNITO_DOMAIN !== "undefined" ? String(COGNITO_DOMAIN).trim() : "";
  return d.replace(/\/+$/, "");
}

function getCognitoClientId() {
  return typeof COGNITO_CLIENT_ID !== "undefined" ? String(COGNITO_CLIENT_ID).trim() : "";
}

function getCognitoRedirectUri() {
  return (typeof COGNITO_REDIRECT_URI !== "undefined" ? String(COGNITO_REDIRECT_URI).trim() : "") || (window.location.origin + "/admin-login.html");
}

function getAdminToken() {
  return sessionStorage.getItem(TOK) || "";
}

function clearAuthSession() {
  sessionStorage.removeItem(TOK);
  sessionStorage.removeItem(TOK_ID);
  sessionStorage.removeItem("pkce_verifier");
  sessionStorage.removeItem("pkce_state");
}

/* ===== PKCE (OAuth 2.0 Authorization Code Flow) Cryptographic Helpers ===== */
function generateRandomString(length = 64) {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = new Uint8Array(length);
  window.crypto.getRandomValues(values);
  return Array.from(values, x => charset[x % charset.length]).join("");
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/* ===== Reusable HTTP Helper (Fetch) ===== */
async function http(path, opt = {}) {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl || baseUrl.includes("PASTE_API_GATEWAY_INVOKE_URL_HERE")) {
    throw new Error("AWS API Gateway Invoke URL is not configured. Please set API_BASE_URL in assets/js/config.js.");
  }

  const url = path.startsWith("http") ? path : `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  const isAdminPath = path.includes("/admin");
  const token = getAdminToken();

  const headers = { ...opt.headers };

  if (opt.body && typeof opt.body === "string" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  if (isAdminPath && token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(url, { ...opt, headers });
  } catch (netErr) {
    throw new Error("Unable to connect to SSM IET cloud servers. Please check your internet connection.");
  }

  // Handle Token Expiry / Unauthorized Access
  if ((res.status === 401 || res.status === 403) && isAdminPath) {
    clearAuthSession();
    alert("Administrative session has expired or is unauthorized. Redirecting to admin sign in...");
    window.location.replace("admin-login.html");
    throw new Error("Unauthorized access. Redirecting to login...");
  }

  if (!res.ok) {
    let errMessage = `Request failed with status ${res.status}`;
    try {
      const errJson = await res.json();
      errMessage = errJson.message || errJson.error || errJson.msg || errMessage;
    } catch (_) {
      try {
        const text = await res.text();
        if (text && text.length < 240) errMessage = text;
      } catch (__) {}
    }
    throw new Error(errMessage);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

/* ===== API Layer: Real AWS Backend Integration ===== */
const API = {
  // GET /courses
  async courses() {
    const r = await http("/courses");
    const list = Array.isArray(r) ? r : (r.items || r.courses || []);
    return list.map((c, i) => ({
      id: c.courseId || c.id || `c${i + 1}`,
      name: c.name || c.courseName || "",
      level: c.level || c.category || "UG"
    }));
  },

  // POST /applications
  async submitApplication(rec) {
    return http("/applications", {
      method: "POST",
      body: JSON.stringify(rec)
    });
  },

  // POST /documents/upload-url
  async getUploadUrl(applicationId, docKey, file) {
    return http("/documents/upload-url", {
      method: "POST",
      body: JSON.stringify({
        applicationId,
        documentType: docKey,
        docKey: docKey,
        key: docKey,
        contentType: file.type || "application/octet-stream",
        fileSize: file.size,
        size: file.size
      })
    });
  },

  // Upload file directly to S3 via pre-signed URL (never send Authorization token)
  async uploadFileToS3(uploadUrl, file) {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/octet-stream"
      },
      body: file
    });
    if (!res.ok) {
      throw new Error(`S3 direct upload failed with status ${res.status}`);
    }
    return true;
  },

  // GET /applications/status?applicationId=...&mobile=...
  async status(applicationId, mobile) {
    const q = `applicationId=${encodeURIComponent(applicationId)}&mobile=${encodeURIComponent(mobile)}&id=${encodeURIComponent(applicationId)}`;
    return http(`/applications/status?${q}`);
  },

  // GET /admin/applications
  async list() {
    const r = await http("/admin/applications");
    return Array.isArray(r) ? r : (r.items || r.applications || []);
  },

  // GET /admin/applications/{applicationId}
  async get(id) {
    return http(`/admin/applications/${encodeURIComponent(id)}`);
  },

  // PATCH /admin/applications/{applicationId}/status
  async patch(id, patchData) {
    const body = {
      status: patchData.status,
      internalNote: patchData.internalNote || patchData.note,
      studentVisibleMessage: patchData.studentVisibleMessage || patchData.message,
      contact: patchData.contact
    };
    return http(`/admin/applications/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
  },

  // GET /admin/reports/export
  async exportReport() {
    const baseUrl = getApiBaseUrl();
    const token = getAdminToken();
    if (!token) throw new Error("Administrative authentication required.");

    const res = await fetch(`${baseUrl}/admin/reports/export`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        clearAuthSession();
        alert("Session expired. Please sign in again.");
        window.location.replace("admin-login.html");
      }
      throw new Error(`Failed to export report (${res.status})`);
    }

    const blob = await res.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = "ssmiet-applications.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(downloadUrl);
    }, 1000);
  }
};

/* ===== Shared UI Components ===== */
const badge = s => `<span class="bd s-${String(s || "submitted").toLowerCase().replace(/[^a-z]+/g, "-")}">${esc(s || "Submitted")}</span>`;

function timeline(a) {
  const historyList = Array.isArray(a.history) ? a.history : [];
  const got = new Map(historyList.map(h => [h.status, h.at || h.timestamp]));
  const currentStatus = a.status || "Submitted";

  const st = FLOW.map(s => {
    const isDone = got.has(s);
    const isCur = currentStatus === s;
    return `<li class="${isDone ? "done" : ""} ${isCur ? "cur" : ""}"${isCur ? ' aria-current="step"' : ""}><b>${esc(s)}</b><small>${isDone ? fmt(got.get(s)) : "Pending"}</small></li>`;
  }).join("");

  const ex = ["Correction Requested", "Rejected"]
    .filter(s => got.has(s))
    .map(s => `<li class="done bad ${currentStatus === s ? "cur" : ""}"><b>${esc(s)}</b><small>${fmt(got.get(s))}</small></li>`)
    .join("");

  return `<ol class="tl">${st}${ex}</ol>`;
}

const table = rows => {
  if (!rows || !rows.length) {
    return `<p class="empty">No applications found.</p>`;
  }
  return `<div class="tw"><table><thead><tr><th>ID</th><th>Name</th><th>Programme</th><th>Status</th><th>Submitted</th></tr></thead><tbody>${rows.map(a => {
    const appId = a.applicationId || a.id || "—";
    const appName = a.name || a.studentName || "—";
    const appProg = a.programme || a.course || "—";
    const appStatus = a.status || "Submitted";
    const appDate = a.createdAt || a.submittedAt || "—";
    return `<tr><td><a href="admin-application-detail.html?id=${encodeURIComponent(appId)}">${esc(appId)}</a></td><td>${esc(appName)}</td><td>${esc(appProg)}</td><td>${badge(appStatus)}</td><td>${fmt(appDate)}</td></tr>`;
  }).join("")}</tbody></table></div>`;
};

/* ===== Visual Scenery, Background & Interactive Animation Engine ===== */
function bgLayer() {
  if ($("#bgl")) return;
  const d = document.createElement("div");
  d.className = "bg";
  d.id = "bgl";

  const svgs = [
    { x: 5, y: 12, s: 58, d: 22, dl: -3, tx: 28, ty: -38, r: 25, c: "k0" },
    { x: 88, y: 8, s: 72, d: 26, dl: -7, tx: -32, ty: 40, r: -30, c: "k1" },
    { x: 92, y: 42, s: 48, d: 19, dl: -2, tx: -24, ty: -32, r: 20, c: "k0" },
    { x: 4, y: 58, s: 66, d: 24, dl: -11, tx: 35, ty: 28, r: -25, c: "k1" },
    { x: 82, y: 76, s: 60, d: 21, dl: -5, tx: -28, ty: -36, r: 35, c: "k2" },
    { x: 18, y: 82, s: 46, d: 18, dl: -9, tx: 22, ty: -28, r: -20, c: "k0" },
    { x: 48, y: 6, s: 38, d: 20, dl: -4, tx: 18, ty: 22, r: 40, c: "k1" },
    { x: 52, y: 90, s: 50, d: 23, dl: -12, tx: -24, ty: -22, r: -35, c: "k2" }
  ];

  const hx = svgs.map(s => `<svg style="left:${s.x}%;top:${s.y}%;width:${s.s}px;height:${s.s * 0.9}px;--dur:${s.d}s;--del:${s.dl}s;--tx:${s.tx}px;--ty:${s.ty}px;--rot:${s.r}deg" viewBox="0 0 100 90"><polygon class="${s.c}" points="25,3 75,3 100,45 75,87 25,87 0,45"/></svg>`).join("");

  const pts = Array.from({ length: 24 }, (_, i) => {
    const l = Math.round((i * 4.2) % 96 + 2);
    const dl = (i * 0.65).toFixed(2);
    const dur = (10 + (i % 7) * 2.5).toFixed(1);
    const sz = (3 + (i % 4) * 1.5).toFixed(1);
    const drift = ((i % 2 === 0 ? 1 : -1) * (12 + i * 1.8)).toFixed(0);
    return `<b style="left:${l}%;--dur:${dur}s;--del:${dl}s;--sz:${sz}px;--drift:${drift}px"></b>`;
  }).join("");

  d.innerHTML = `<div class="bg-spotlight"></div><div class="bl b1"></div><div class="bl b2"></div><div class="bl b3"></div><div class="bl b4"></div>${hx}${pts}`;
  document.body.prepend(d);
}

function initInteractiveEffects() {
  if (RM) return;

  // 1. Button click ripple
  document.addEventListener("pointerdown", e => {
    const b = e.target.closest(".btn");
    if (!b) return;
    const r = b.getBoundingClientRect();
    const rip = document.createElement("span");
    rip.className = "ripple-wave";
    const sz = Math.max(r.width, r.height) * 2.2;
    rip.style.width = rip.style.height = `${sz}px`;
    rip.style.left = `${e.clientX - r.left - sz / 2}px`;
    rip.style.top = `${e.clientY - r.top - sz / 2}px`;
    b.appendChild(rip);
    setTimeout(() => rip.remove(), 600);
  });

  // 2. Interactive Spotlight Cursor Tracker on Background
  const bgl = $("#bgl");
  if (bgl) {
    let tx = window.innerWidth / 2, ty = window.innerHeight / 3, cx = tx, cy = ty, raf = null;
    const loop = () => {
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      bgl.style.setProperty("--gx", `${cx.toFixed(1)}px`);
      bgl.style.setProperty("--gy", `${cy.toFixed(1)}px`);
      if (Math.abs(tx - cx) > 0.5 || Math.abs(ty - cy) > 0.5) raf = requestAnimationFrame(loop);
      else raf = null;
    };
    window.addEventListener("pointermove", e => {
      tx = e.clientX;
      ty = e.clientY;
      if (!raf) raf = requestAnimationFrame(loop);
    }, { passive: true });
  }

  // 3. Interactive Subtle 3D Card Tilt for Desktop
  if (window.matchMedia("(min-width: 768px)").matches) {
    document.addEventListener("pointermove", e => {
      const c = e.target.closest(".feat > div, .way > div, .card.hv");
      if (!c) return;
      const r = c.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      c.style.transform = `perspective(800px) rotateX(${(-y * 6).toFixed(1)}deg) rotateY(${(x * 6).toFixed(1)}deg) translateY(-6px)`;
    }, { passive: true });

    document.addEventListener("pointerout", e => {
      const c = e.target.closest(".feat > div, .way > div, .card.hv");
      if (c && !c.contains(e.relatedTarget)) c.style.transform = "";
    }, { passive: true });
  }
}

function initScrollFeatures() {
  if ($("#stk") || RM) return;
  const bar = document.createElement("div");
  bar.className = "scroll-tracker";
  bar.id = "stk";
  document.body.prepend(bar);

  const btn = document.createElement("button");
  btn.className = "scroll-top-btn";
  btn.setAttribute("aria-label", "Scroll to top");
  btn.innerHTML = `<svg class="progress-ring" viewBox="0 0 40 40"><circle class="progress-circle" cx="20" cy="20" r="16"/></svg><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 15l-6-6-6 6"/></svg>`;
  document.body.appendChild(btn);

  btn.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
  const circ = btn.querySelector(".progress-circle");
  const len = 2 * Math.PI * 16;
  circ.style.strokeDasharray = len;
  circ.style.strokeDashoffset = len;

  let tick = false;
  window.addEventListener("scroll", () => {
    if (!tick) {
      requestAnimationFrame(() => {
        const h = document.documentElement.scrollHeight - window.innerHeight;
        const p = h > 0 ? Math.min(window.scrollY / h, 1) : 0;
        bar.style.width = `${(p * 100).toFixed(1)}%`;
        circ.style.strokeDashoffset = (len * (1 - p)).toFixed(1);
        btn.classList.toggle("visible", window.scrollY > 280);
        tick = false;
      });
      tick = true;
    }
  }, { passive: true });
}

/* ===== Global Navigation & Shell ===== */
function shell() {
  const adm = document.body.hasAttribute("data-admin");
  const pg = document.body.dataset.page;
  const L = adm
    ? [["admin-dashboard.html", "Dashboard"], ["admin-applications.html", "Applications"], ["#out", "Logout"]]
    : [["index.html", "Home"], ["programmes.html", "Programmes"], ["apply.html", "Apply"], ["track-status.html", "Track Status"], ["admin-login.html", "Admin"]];

  const header = $("#h");
  if (header) {
    header.innerHTML = `<a class="skip" href="#m">Skip to content</a><div class="wrap bar"><a class="logo" href="index.html" aria-label="SSM IET home"><img src="assets/images/ssmiet-logo.png" alt="SSM IET" width="46" height="46"><span class="bn"><b>SSM Institute of Engineering &amp; Technology</b><i>Infinite Possibilities Begin Here</i></span></a><button class="menu-btn" id="mb" aria-label="Toggle navigation" aria-expanded="false"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button><nav id="nv" aria-label="Main">${L.map(([h, t]) => `<a href="${h}"${h === pg + ".html" ? ' aria-current="page"' : ""}>${esc(t)}</a>`).join("")}</nav></div>`;
    
    header.insertAdjacentHTML("beforebegin", `<div class="top"><div class="wrap"><span>Counselling Code: <b>5530</b></span><span><a href="tel:7373707002">7373707002</a> · <a href="https://www.ssmiet.ac.in" rel="noopener noreferrer">www.ssmiet.ac.in</a></span></div></div>`);
    
    if (pg !== "index") {
      const t = esc(document.title.split("|")[0].trim());
      header.insertAdjacentHTML("afterend", `<section class="ph" aria-hidden="true"><div class="wrap"><p>Home &nbsp;/&nbsp; ${t}</p><div class="pt">${t}</div></div></section>`);
    }

    const logoImg = $(".logo img");
    if (logoImg) {
      logoImg.onerror = e => e.target.replaceWith(Object.assign(document.createElement("b"), { className: "tx", textContent: "SSM IET" }));
    }

    // Admin Logout Handler
    const logoutBtn = $('a[href="#out"]');
    if (logoutBtn) {
      logoutBtn.onclick = e => {
        e.preventDefault();
        clearAuthSession();
        window.location.replace("admin-login.html");
      };
    }

    const mb = $("#mb"), nv = $("#nv");
    if (mb && nv) {
      mb.onclick = () => {
        const op = nv.classList.toggle("open");
        mb.setAttribute("aria-expanded", String(op));
      };
    }
  }

  const footer = $("#f");
  if (footer) {
    footer.innerHTML = `<div class="wrap fg"><div class="fb"><img src="assets/images/ssmiet-logo.png" alt="" width="52" height="52"><div><b>SSM Institute of Engineering and Technology</b><p>An Autonomous Institution</p><p>Palani Highway, Dindigul – 624002</p></div></div><div><h4>Explore</h4><a href="programmes.html">Programmes</a><a href="apply.html">Apply Now</a><a href="track-status.html">Track Status</a></div><div><h4>Contact</h4><p>Counselling Code: 5530</p><a href="tel:7373707002">7373707002</a><a href="https://www.ssmiet.ac.in" rel="noopener noreferrer">www.ssmiet.ac.in</a></div></div><p class="wrap cp">Approved by AICTE, New Delhi • Affiliated to Anna University, Chennai • Accredited by NAAC &amp; NBA<br>© ${new Date().getFullYear()} SSM Institute of Engineering and Technology</p>`;
  }
}

function reveal() {
  const io = new IntersectionObserver(es => es.forEach(x => {
    if (x.isIntersecting) {
      x.target.classList.add("in");
      io.unobserve(x.target);
    }
  }), { threshold: 0.08 });
  $$(".rv").forEach(e => io.observe(e));
}

function counters() {
  const io = new IntersectionObserver(es => es.forEach(x => {
    if (!x.isIntersecting) return;
    const e = x.target;
    io.unobserve(e);
    const n = +e.dataset.count;
    if (RM || isNaN(n)) {
      e.textContent = n || 0;
      return;
    }
    let s = null;
    const f = t => {
      s ??= t;
      const p = Math.min((t - s) / 900, 1);
      e.textContent = Math.round(n * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(f);
      else e.classList.add("count-popped");
    };
    requestAnimationFrame(f);
  }));
  $$("[data-count]").forEach(e => io.observe(e));
}

/* ===== Home Page Handler ===== */
function pHome() {
  counters();

  // 3D Hexagon Display Parallax
  const hw = $(".hexwrap");
  if (hw && !RM) {
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = null;
    const loop = () => {
      cx += (tx - cx) * 0.1;
      cy += (ty - cy) * 0.1;
      hw.style.setProperty("--mx", cx.toFixed(2));
      hw.style.setProperty("--my", cy.toFixed(2));
      if (Math.abs(tx - cx) > 0.01 || Math.abs(ty - cy) > 0.01) raf = requestAnimationFrame(loop);
      else raf = null;
    };
    hw.onpointermove = e => {
      const r = hw.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    hw.onpointerleave = () => {
      tx = 0;
      ty = 0;
      if (!raf) raf = requestAnimationFrame(loop);
    };
  }

  // Load Active Programmes from AWS
  const pl = $("#pl");
  if (pl) pl.innerHTML = `<p class="empty">Loading programmes...</p>`;

  API.courses().then(all => {
    const by = l => all.filter(c => c.level === l);

    // Update stats band counters if elements exist
    const bProg = $('b[data-count="15"]');
    if (bProg && all.length) bProg.dataset.count = all.length;
    const bUg = $('b[data-count="10"]');
    if (bUg) bUg.dataset.count = by("UG").length;
    const bPg = $('b[data-count="2"]');
    if (bPg) bPg.dataset.count = by("PG").length;
    const bPhd = $('b[data-count="3"]');
    if (bPhd) bPhd.dataset.count = by("Ph.D.").length;
    counters();

    if (pl) {
      pl.innerHTML = [["UG", "Undergraduate"], ["PG", "Postgraduate"], ["Ph.D.", "Ph.D."]].map(([l, t]) => {
        const progs = by(l);
        return `<div class="pcol rv"><h3><b>${progs.length}</b>${esc(t)}</h3>${progs.map(c => `<a href="apply.html?p=${encodeURIComponent(c.id)}"><span>${esc(c.name)}</span><svg class="arr" viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true"><path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/></svg></a>`).join("")}</div>`;
      }).join("");
    }

    const tk = $("#tk");
    if (tk) {
      const tickerText = all.map(c => `<span>${esc(c.name.replace(/\s*\(.*\)/, ""))}</span>`).join("");
      tk.innerHTML = tickerText + tickerText;
    }
    reveal();
  }).catch(err => {
    if (pl) pl.innerHTML = `<p class="empty" role="alert">Unable to load programmes from AWS server (${esc(err.message)}).</p>`;
  });
}

/* ===== Programmes Page Handler ===== */
async function pProgrammes() {
  const g = $("#grid"), q = $("#q"), l = $("#lv");
  if (!g) return;

  g.innerHTML = `<p class="empty">Loading programmes from AWS...</p>`;

  let all = [];
  try {
    all = await API.courses();
  } catch (err) {
    g.innerHTML = `<p class="empty" role="alert" style="color:#E11D48">Failed to load programmes: ${esc(err.message)}</p>`;
    return;
  }

  const p = new URLSearchParams(location.search).get("l");
  if (p && l) l.value = p;

  const draw = () => {
    const v = q ? q.value.toLowerCase().trim() : "";
    const filterLevel = l ? l.value : "";
    const r = all.filter(c => (!filterLevel || c.level === filterLevel) && c.name.toLowerCase().includes(v));

    g.innerHTML = r.length
      ? r.map(c => `<article class="card hv rv"><span class="bd">${esc(c.level)}</span><h3>${esc(c.name)}</h3><a class="btn sm" href="apply.html?p=${encodeURIComponent(c.id)}">Apply Now <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg></a></article>`).join("")
      : `<p class="empty">No programmes match your search query.</p>`;
    reveal();
  };

  if (q) q.oninput = draw;
  if (l) l.onchange = draw;
  draw();
}

/* ===== Application Form Flow (5-Step) ===== */
const STEPS = [
  ["Personal", [["name", "Full name"], ["dob", "Date of birth", "date"], ["gender", "Gender", "select", ["Male", "Female", "Other"]], ["email", "Email address", "email"], ["mobile", "Mobile number (10 digits)", "tel"], ["alt", "Alternate mobile (optional)", "tel", , 1], ["address", "Address", "textarea"]]],
  ["Academic", [["inst", "Previous institution"], ["reg", "Register number"], ["dept", "Department / stream"], ["year", "Year of study / passing", "number"], ["sem", "Semester", "number"], ["score", "CGPA / percentage", "number"]]],
  ["Programme", [["programme", "Programme", "select", []], ["batch", "Preferred batch", "select", ["2026 batch", "2027 batch"]], ["mode", "Learning mode", "select", ["On-campus", "Hybrid"]]]],
  ["Guardian", [["gname", "Guardian name"], ["gmobile", "Guardian mobile", "tel"]]],
  ["Documents", []]
];

const OKT = ["application/pdf", "image/jpeg", "image/png"];
const MAXB = 2 * 1024 * 1024; // 2 MB browser limit

const mob = v => /^[6-9]\d{9}$/.test(v) || "Enter a valid 10-digit Indian mobile number.";
const RULE = {
  email: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || "Enter a valid email address.",
  mobile: mob,
  alt: mob,
  gmobile: mob,
  dob: v => new Date(v) < new Date() || "Date of birth must be in the past."
};

const field = ([k, l, t = "text", o, opt]) => {
  const id = `f_${k}`;
  const rq = opt ? "" : " required";
  let c;
  if (t === "select") {
    c = `<select id="${id}" name="${k}"${rq}><option value="">Select…</option>${o.map(x => `<option>${esc(x)}</option>`).join("")}</select>`;
  } else if (t === "textarea") {
    c = `<textarea id="${id}" name="${k}" rows="3"${rq}></textarea>`;
  } else {
    c = `<input id="${id}" name="${k}" type="${t}"${t === "tel" ? ' inputmode="numeric" maxlength="10"' : ""}${t === "number" ? ' step="any" min="0"' : ""}${rq}>`;
  }
  return `<div class="fld"><label for="${id}">${esc(l)}${opt ? "" : " *"}</label>${c}<small class="err" id="e_${k}" role="alert"></small></div>`;
};

const docField = ([k, l, r]) => `<div class="fld"><label for="d_${k}">${esc(l)}${r ? " *" : " (optional)"}</label><input id="d_${k}" type="file" accept=".pdf,.jpg,.jpeg,.png"><small class="err" id="e_d_${k}" role="alert"></small></div>`;

function vStep(i) {
  let ok = true;
  const set = (id, msg, k) => {
    const errEl = $("#e_" + k);
    if (errEl) errEl.textContent = msg || "";
    const inputEl = $("#" + id);
    if (inputEl) inputEl.setAttribute("aria-invalid", String(Boolean(msg)));
    if (msg) ok = false;
  };

  if (i < 4) {
    STEPS[i][1].forEach(([k, , , , opt]) => {
      const inputEl = $("#f_" + k);
      const v = inputEl ? inputEl.value.trim() : "";
      let m = "";
      if (!v && !opt) m = "This field is required.";
      else if (v && RULE[k]) {
        const r = RULE[k](v);
        if (r !== true) m = r;
      }
      set(`f_${k}`, m, k);
    });
  } else {
    DOCS.forEach(([k, , req]) => {
      const inputEl = $("#d_" + k);
      const f = inputEl && inputEl.files ? inputEl.files[0] : null;
      let m = "";
      if (!f) {
        m = req ? "Please upload this document." : "";
      } else if (!OKT.includes(f.type) && !/\.(pdf|jpe?g|png)$/i.test(f.name)) {
        m = "Only PDF, JPG, or PNG files are accepted.";
      } else if (f.size > MAXB) {
        m = "File size must be 2 MB or smaller.";
      }
      set(`d_${k}`, m, `d_${k}`);
    });
  }
  return ok;
}

async function pApply() {
  const form = $("#af"), nav = $("#steps");
  if (!form || !nav) return;

  // Load courses from AWS to populate programme choices
  let courses = [];
  try {
    courses = await API.courses();
    STEPS[2][1][0][3] = courses.map(c => c.name);
  } catch (err) {
    form.innerHTML = `<p class="empty" role="alert" style="color:#E11D48">Failed to connect to AWS services: ${esc(err.message)}</p>`;
    return;
  }

  let i = 0;
  form.innerHTML = STEPS.map((s, n) => `<fieldset id="s${n}" hidden><legend>${n + 1}. ${esc(s[0])}</legend>${n < 4 ? s[1].map(field).join("") : DOCS.map(docField).join("") + `<p class="hint">PDF, JPG, or PNG, strictly up to 2 MB each.</p>`}</fieldset>`).join("") +
    `<div id="upload-feedback" aria-live="polite" style="margin-top:1rem"></div><div class="actions"><button type="button" class="btn ghost" id="bk">Back</button><button type="button" class="btn" id="nx">Next</button><button type="submit" class="btn" id="sb" hidden>Submit Application</button></div>`;

  const show = n => {
    i = n;
    STEPS.forEach((_, k) => {
      const fs = $("#s" + k);
      if (fs) fs.hidden = k !== n;
    });
    nav.innerHTML = STEPS.map((s, k) => `<li class="${k < n ? "done" : ""}${k === n ? " cur" : ""}"${k === n ? ' aria-current="step"' : ""}>${k < n ? '<span class="sn">✓</span>' : `<span class="sn">${k + 1}</span>`}<span class="st">${esc(s[0])}</span></li>`).join("");

    $("#bk").hidden = !n;
    $("#nx").hidden = n === 4;
    $("#sb").hidden = n !== 4;
    if (n) {
      const firstInput = $("#s" + n).querySelector("input,select,textarea");
      if (firstInput) firstInput.focus();
    }
  };

  $("#bk").onclick = () => show(i - 1);
  $("#nx").onclick = () => vStep(i) && show(i + 1);

  // Pre-select course from URL query param if present
  const queryParam = new URLSearchParams(location.search).get("p");
  if (queryParam) {
    const matched = courses.find(x => x.id === queryParam || x.name === queryParam);
    if (matched) {
      const progSelect = $("#f_programme");
      if (progSelect) progSelect.value = matched.name;
    }
  }

  // Handle Form Submission + Secure Document Upload via Pre-signed URLs
  form.onsubmit = async e => {
    e.preventDefault();
    for (let k = 0; k < 5; k++) {
      if (!vStep(k)) {
        show(k);
        return;
      }
    }

    const rec = {};
    const filesToUpload = [];

    STEPS.slice(0, 4).forEach(s => s[1].forEach(([k]) => {
      const inputEl = $("#f_" + k);
      if (inputEl) rec[k] = inputEl.value.trim();
    }));

    DOCS.forEach(([k, label]) => {
      const inputEl = $("#d_" + k);
      const file = inputEl && inputEl.files ? inputEl.files[0] : null;
      if (file) {
        filesToUpload.push({ key: k, label, file });
      }
    });

    const sb = $("#sb");
    sb.disabled = true;
    const feedback = $("#upload-feedback");
    feedback.innerHTML = `<p class="empty" style="color:var(--o)">Submitting application data to SSM IET cloud...</p>`;

    try {
      // 1. Submit application to POST /applications
      const appRes = await API.submitApplication(rec);
      const appId = appRes.applicationId || appRes.id;
      if (!appId) throw new Error("Application was submitted but no Application ID was returned.");

      // 2. Upload documents via POST /documents/upload-url + direct S3 PUT
      if (filesToUpload.length > 0) {
        for (let idx = 0; idx < filesToUpload.length; idx++) {
          const item = filesToUpload[idx];
          feedback.innerHTML = `<p class="empty" style="color:var(--o)">Uploading ${esc(item.label)} (${idx + 1} of ${filesToUpload.length})...</p>`;

          // Get pre-signed URL from Lambda
          const urlData = await API.getUploadUrl(appId, item.key, item.file);
          const uploadUrl = urlData.uploadUrl || urlData.url;
          if (!uploadUrl) {
            throw new Error(`Failed to generate secure upload URL for ${item.label}.`);
          }

          // Direct S3 PUT with exact Content-Type (NO Authorization token)
          await API.uploadFileToS3(uploadUrl, item.file);
        }
      }

      feedback.innerHTML = `<p class="empty" style="color:var(--m)">Application submitted successfully! Redirecting...</p>`;
      sessionStorage.setItem("last", appId);
      sessionStorage.setItem("last_prog", rec.programme || "");

      await wait(500);
      window.location.href = `application-success.html?id=${encodeURIComponent(appId)}&p=${encodeURIComponent(rec.programme || "")}`;
    } catch (err) {
      sb.disabled = false;
      feedback.innerHTML = `<p class="empty" role="alert" style="color:#E11D48">Submission Error: ${esc(err.message || "Failed to submit application.")}</p>`;
    }
  };

  show(0);
}

/* ===== Application Success Handler ===== */
function pSuccess() {
  const params = new URLSearchParams(location.search);
  const id = params.get("id") || sessionStorage.getItem("last") || "—";
  const prog = params.get("p") || sessionStorage.getItem("last_prog") || "";

  const aid = $("#aid");
  if (aid) {
    aid.innerHTML = `<span>${esc(id)}</span> <button type="button" class="btn sm ghost" id="cp" style="margin-left:0.6rem;vertical-align:middle;padding:0.35rem 0.8rem">Copy ID</button>`;
    const b = $("#cp");
    if (b) {
      b.onclick = () => {
        navigator.clipboard?.writeText(id);
        b.textContent = "Copied!";
        setTimeout(() => b.textContent = "Copy ID", 2000);
      };
    }

    if (prog && !$("#success-course")) {
      const pInfo = document.createElement("p");
      pInfo.id = "success-course";
      pInfo.style.margin = "0.75rem 0 1.25rem";
      pInfo.innerHTML = `Selected Programme: <b>${esc(prog)}</b>`;
      aid.insertAdjacentElement("afterend", pInfo);
    }
  }
}

/* ===== Student Status Tracking ===== */
function pTrack() {
  const form = $("#tf");
  if (!form) return;

  form.onsubmit = async e => {
    e.preventDefault();
    const idInput = $("#tid"), mInput = $("#tm");
    const id = idInput ? idInput.value.trim() : "";
    const m = mInput ? mInput.value.trim() : "";
    const o = $("#res");
    if (!o) return;

    if (!id || !m) {
      o.innerHTML = `<p class="empty" role="alert" style="color:#E11D48">Please enter both your Application ID and mobile number.</p>`;
      return;
    }

    o.innerHTML = `<p class="empty">Checking status in SSM IET cloud system...</p>`;

    try {
      const a = await API.status(id, m);
      if (!a || (typeof a === "object" && Object.keys(a).length === 0)) {
        o.innerHTML = `<p class="empty" role="alert">No application found for ID <b>${esc(id)}</b> and mobile <b>${esc(m)}</b>.</p>`;
        return;
      }

      const appId = a.applicationId || a.id || id;
      const appStatus = a.status || "Submitted";
      const appProg = a.programme || a.course || "—";
      const appDate = a.createdAt || a.submittedAt || new Date().toISOString();
      const history = Array.isArray(a.history) ? a.history : [{ status: appStatus, at: appDate }];
      const messages = Array.isArray(a.messages) ? a.messages : [];

      o.innerHTML = `
        <section class="card">
          <h2>${esc(appId)} ${badge(appStatus)}</h2>
          <p><b>${esc(appProg)}</b> · Submitted ${fmt(appDate)}</p>
          ${timeline({ status: appStatus, history })}
          ${messages.length ? `
            <div style="margin-top:1.5rem">
              <h3>Messages from Admissions</h3>
              ${messages.map(x => `<p class="msg">${esc(typeof x === "string" ? x : (x.text || x.message))}<br><small>${fmt(x.at || x.timestamp || new Date())}</small></p>`).join("")}
            </div>
          ` : ""}
        </section>
      `;
    } catch (err) {
      o.innerHTML = `<p class="empty" role="alert">No application found for that ID and mobile number.</p>`;
    }
  };
}

/* ===== Admin Authentication & Cognito Hosted UI PKCE Flow ===== */
async function pLogin() {
  const er = $("#er");
  const authStatus = $("#auth-status");
  const cognitoBtn = $("#cognito-btn");
  const mockSection = $("#mock-login-section");
  const mockForm = $("#lf");

  // Show mock login section only if MOCK_MODE is enabled
  if (mockSection) {
    mockSection.hidden = !isMockMode();
  }

  // Handle Cognito OAuth 2.0 Authorization Code callback
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const oauthErr = params.get("error");
  const oauthErrDesc = params.get("error_description");

  if (oauthErr) {
    if (er) er.textContent = oauthErrDesc || oauthErr || "Authentication request was denied.";
    return;
  }

  if (code) {
    if (authStatus) authStatus.innerHTML = `<p class="empty" style="color:var(--o)">Exchanging authentication code with AWS Cognito...</p>`;
    if (cognitoBtn) cognitoBtn.disabled = true;

    const verifier = sessionStorage.getItem("pkce_verifier");
    const domain = getCognitoDomain();
    const clientId = getCognitoClientId();
    const redirectUri = getCognitoRedirectUri();

    if (!verifier) {
      if (er) er.textContent = "Login session verifier expired. Please click below to sign in again.";
      if (cognitoBtn) cognitoBtn.disabled = false;
      if (authStatus) authStatus.innerHTML = "";
      return;
    }

    try {
      const tokenUrl = `${domain}/oauth2/token`;
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier
      });

      const tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: tokenBody.toString()
      });

      if (!tokenRes.ok) {
        const errJson = await tokenRes.json().catch(() => ({}));
        throw new Error(errJson.error_description || errJson.error || `Token exchange failed (${tokenRes.status})`);
      }

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        throw new Error("No access token was returned by Cognito.");
      }

      // Store access token in sessionStorage (never localStorage)
      sessionStorage.setItem(TOK, tokenData.access_token);
      if (tokenData.id_token) sessionStorage.setItem(TOK_ID, tokenData.id_token);
      sessionStorage.removeItem("pkce_verifier");
      sessionStorage.removeItem("pkce_state");

      if (authStatus) authStatus.innerHTML = `<p class="empty" style="color:var(--m)">Sign in successful! Loading dashboard...</p>`;

      const target = sessionStorage.getItem("admin_redirect") || "admin-dashboard.html";
      sessionStorage.removeItem("admin_redirect");
      await wait(400);
      window.location.replace(target);
      return;
    } catch (err) {
      if (cognitoBtn) cognitoBtn.disabled = false;
      if (authStatus) authStatus.innerHTML = "";
      if (er) er.textContent = `Sign in error: ${err.message}`;
      return;
    }
  }

  // Normal Visit: Initiate Cognito Hosted UI Login with PKCE
  if (cognitoBtn) {
    cognitoBtn.onclick = async () => {
      const domain = getCognitoDomain();
      const clientId = getCognitoClientId();
      const redirectUri = getCognitoRedirectUri();

      if (!domain || domain.includes("PASTE_COGNITO_HOSTED_UI_DOMAIN_HERE")) {
        if (er) er.textContent = "Cognito Domain is not configured. Please set COGNITO_DOMAIN in assets/js/config.js.";
        return;
      }
      if (!clientId || clientId.includes("PASTE_COGNITO_APP_CLIENT_ID_HERE")) {
        if (er) er.textContent = "Cognito Client ID is not configured. Please set COGNITO_CLIENT_ID in assets/js/config.js.";
        return;
      }

      try {
        const verifier = generateRandomString(64);
        const challenge = await generateCodeChallenge(verifier);
        const state = generateRandomString(32);

        sessionStorage.setItem("pkce_verifier", verifier);
        sessionStorage.setItem("pkce_state", state);

        const authUrl = `${domain}/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256&state=${encodeURIComponent(state)}`;
        window.location.href = authUrl;
      } catch (err) {
        if (er) er.textContent = `Failed to generate PKCE challenge: ${err.message}`;
      }
    };
  }

  // Mock Mode Login fallback
  if (mockForm && isMockMode()) {
    mockForm.onsubmit = e => {
      e.preventDefault();
      sessionStorage.setItem(TOK, "mock-admin-token");
      window.location.href = "admin-dashboard.html";
    };
  }
}

/* ===== Admin Dashboard Handler ===== */
async function pDash() {
  const kp = $("#kp"), ch = $("#ch"), rc = $("#rc");
  if (kp) kp.innerHTML = `<p class="empty">Loading dashboard data from AWS...</p>`;

  let a = [];
  try {
    a = await API.list();
  } catch (err) {
    if (kp) kp.innerHTML = `<p class="empty" role="alert" style="color:#E11D48">Failed to load applications: ${esc(err.message)}</p>`;
    return;
  }

  const c = s => a.filter(x => x.status === s).length;
  if (kp) {
    kp.innerHTML = [
      ["Total applications", a.length, "kpi-total"],
      ["Under review", c("Under Review"), "kpi-review"],
      ["Callback required", c("Callback Required"), "kpi-callback"],
      ["Confirmed", c("Confirmed"), "kpi-confirmed"]
    ].map(([l, n, k]) => `<div class="rv ${k}"><div class="kpi-hdr"><span class="kpi-dot"></span><span>${esc(l)}</span></div><b data-count="${n}">0</b></div>`).join("");
  }

  if (ch) {
    const by = {};
    a.forEach(x => {
      const prog = x.programme || x.course || "Other";
      by[prog] = (by[prog] || 0) + 1;
    });
    const mx = Math.max(1, ...Object.values(by));
    ch.innerHTML = Object.entries(by).sort((x, y) => y[1] - x[1]).map(([p, n]) => `
      <div class="cb">
        <div><span>${esc(p)}</span><b>${n}</b></div>
        <div class="trk"><i style="width:${(n / mx * 100).toFixed(1)}%"></i></div>
      </div>
    `).join("") || `<p class="empty">No applications data recorded yet.</p>`;
  }

  if (rc) {
    const recent = a.slice().sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || ""))).slice(0, 5);
    rc.innerHTML = table(recent);
  }

  reveal();
  counters();
}

/* ===== Admin Applications List Handler ===== */
async function pApps() {
  const tb = $("#tb");
  if (tb) tb.innerHTML = `<p class="empty">Loading applications from AWS...</p>`;

  let all = [], courses = [];
  try {
    [all, courses] = await Promise.all([API.list(), API.courses()]);
  } catch (err) {
    if (tb) tb.innerHTML = `<p class="empty" role="alert" style="color:#E11D48">Error fetching applications: ${esc(err.message)}</p>`;
    return;
  }

  const fp = $("#fp"), fs = $("#fs"), q = $("#q"), so = $("#so");
  if (fp) fp.innerHTML += courses.map(c => `<option>${esc(c.name)}</option>`).join("");
  if (fs) fs.innerHTML += ALL_STATUS.map(s => `<option>${esc(s)}</option>`).join("");

  let pg = 1, rows = [];
  const N = 5;

  const draw = () => {
    const query = q ? q.value.toLowerCase().trim() : "";
    const filterProg = fp ? fp.value : "";
    const filterStatus = fs ? fs.value : "";
    const sortVal = so ? so.value : "new";

    rows = all.filter(a => {
      const prog = a.programme || a.course || "";
      const stat = a.status || "";
      const text = `${a.name || ""} ${a.id || a.applicationId || ""} ${a.email || ""} ${a.mobile || ""}`.toLowerCase();
      return (!filterProg || prog === filterProg) &&
             (!filterStatus || stat === filterStatus) &&
             text.includes(query);
    });

    rows.sort((x, y) => {
      if (sortVal === "name") return (x.name || "").localeCompare(y.name || "");
      if (sortVal === "old") return String(x.createdAt || "").localeCompare(String(y.createdAt || ""));
      return String(y.createdAt || "").localeCompare(String(x.createdAt || ""));
    });

    const pages = Math.max(1, Math.ceil(rows.length / N));
    pg = Math.min(pg, pages);

    if (tb) {
      tb.innerHTML = rows.length ? table(rows.slice((pg - 1) * N, pg * N)) : `<p class="empty">No applications match your search filters.</p>`;
    }

    const pgn = $("#pgn");
    if (pgn) {
      pgn.innerHTML = `<button class="btn ghost sm" id="pv" ${pg < 2 ? "disabled" : ""}>Previous</button><span>Page ${pg} of ${pages}</span><button class="btn ghost sm" id="np" ${pg >= pages ? "disabled" : ""}>Next</button>`;
      const pv = $("#pv"), np = $("#np");
      if (pv) pv.onclick = () => { pg--; draw(); };
      if (np) np.onclick = () => { pg++; draw(); };
    }
  };

  [q, fp, fs, so].forEach(el => {
    if (el) el.oninput = () => { pg = 1; draw(); };
  });

  const ex = $("#ex");
  if (ex) {
    ex.onclick = async () => {
      ex.disabled = true;
      ex.textContent = "Downloading...";
      try {
        await API.exportReport();
      } catch (err) {
        alert(`Export failed: ${err.message}`);
      } finally {
        ex.disabled = false;
        ex.textContent = "Download CSV";
      }
    };
  }

  draw();
}

/* ===== Admin Application Detail Handler ===== */
const log = (t, l, f) => `<h3>${esc(t)}</h3>` + ((l && l.length) ? `<ul class="log">${l.map(x => `<li>${esc(f(x))}<br><small>${fmt(x.at || x.timestamp || new Date())}</small></li>`).join("")}</ul>` : `<p class="hint">None recorded.</p>`);

async function pDetail() {
  const box = $("#dt");
  if (!box) return;

  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    box.innerHTML = `<p class="empty" role="alert">No application ID specified in query URL.</p>`;
    return;
  }

  box.innerHTML = `<p class="empty">Loading application details from AWS...</p>`;

  let a = null;
  try {
    a = await API.get(id);
  } catch (err) {
    box.innerHTML = `<p class="empty" role="alert" style="color:#E11D48">Failed to fetch application details: ${esc(err.message)}</p>`;
    return;
  }

  if (!a) {
    box.innerHTML = `<p class="empty" role="alert">Application record not found.</p>`;
    return;
  }

  const go = async patchData => {
    box.innerHTML = `<p class="empty">Updating application status on AWS...</p>`;
    try {
      const updated = await API.patch(id, patchData);
      a = updated || a;
      draw();
    } catch (err) {
      alert(`Update failed: ${err.message}`);
      draw();
    }
  };

  const draw = () => {
    const appId = a.applicationId || a.id || id;
    const appStatus = a.status || "Submitted";
    const history = Array.isArray(a.history) ? a.history : [];
    const notes = Array.isArray(a.notes) ? a.notes : [];
    const messages = Array.isArray(a.messages) ? a.messages : [];
    const contacts = Array.isArray(a.contacts) ? a.contacts : [];
    const docs = Array.isArray(a.docs) ? a.docs : [];

    box.innerHTML = `
      <h1>${esc(appId)} ${badge(appStatus)}</h1>
      <div class="two">
        <section class="card">
          <h2>Student Details</h2>
          <dl>
            ${[
              ["Name", a.name],
              ["Date of birth", a.dob],
              ["Gender", a.gender],
              ["Email", a.email],
              ["Mobile", a.mobile],
              ["Alternate mobile", a.alt || "—"],
              ["Address", a.address],
              ["Institution", a.inst],
              ["Register no.", a.reg],
              ["Department", a.dept],
              ["Year / Sem", `${a.year || "—"} / ${a.sem || "—"}`],
              ["CGPA / %", a.score],
              ["Programme", a.programme || a.course],
              ["Batch / Mode", `${a.batch || "—"} · ${a.mode || "—"}`],
              ["Guardian", `${a.gname || "—"} · ${a.gmobile || "—"}`]
            ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || "—")}</dd>`).join("")}
          </dl>
        </section>
        <section class="card">
          <h2>Timeline</h2>
          ${timeline({ status: appStatus, history })}
        </section>
      </div>

      <section class="card">
        <h2>Document Verification (Private S3 Storage)</h2>
        <div class="tw">
          <table>
            <thead>
              <tr><th>Document</th><th>File Name</th><th>Status</th></tr>
            </thead>
            <tbody>
              ${DOCS.map(([k, l]) => {
                const d = docs.find(x => (x.key === k || x.documentType === k));
                return `<tr><td>${esc(l)}</td><td>${d ? esc(d.file || d.fileName || "Uploaded") : "Not uploaded"}</td><td>${d ? (d.verified ? '<span class="bd s-confirmed">Verified</span>' : '<span class="bd s-under-review">Pending Verification</span>') : "—"}</td></tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </section>

      <div class="two">
        <form class="card" id="fst">
          <h2>Update Status</h2>
          <label for="ns">Status</label>
          <select id="ns">
            ${ALL_STATUS.map(s => `<option ${s === appStatus ? "selected" : ""}>${esc(s)}</option>`).join("")}
          </select>
          <label for="ms">Message visible to student (optional)</label>
          <textarea id="ms" rows="2" placeholder="e.g. Please re-upload clearer mark sheet..."></textarea>
          <p><button class="btn">Save Status</button></p>
        </form>

        <form class="card" id="fnt">
          <h2>Internal Note (Staff Only)</h2>
          <label for="nt">Note</label>
          <textarea id="nt" rows="2" placeholder="Internal admission committee remarks..." required></textarea>
          <p><button class="btn">Add Note</button></p>
        </form>
      </div>

      <div class="two">
        <form class="card" id="fct">
          <h2>Record Contact / Callback</h2>
          <label for="ct">Type</label>
          <select id="ct">
            <option>Phone call</option>
            <option>Callback scheduled</option>
            <option>Email</option>
          </select>
          <label for="co">Outcome / Details</label>
          <textarea id="co" rows="2" placeholder="Outcome of telephone contact..." required></textarea>
          <p><button class="btn">Record Contact</button></p>
        </form>

        <section class="card">
          <h2>Notes &amp; Contact Log</h2>
          ${log("Internal Notes", notes, x => typeof x === "string" ? x : x.text)}
          ${log("Student-Visible Messages", messages, x => typeof x === "string" ? x : x.text)}
          ${log("Contact History", contacts, x => typeof x === "string" ? x : `${x.type || "Contact"}: ${x.outcome || "Recorded"}`)}
        </section>
      </div>
    `;

    const fst = $("#fst");
    if (fst) {
      fst.onsubmit = e => {
        e.preventDefault();
        go({
          status: $("#ns").value,
          studentVisibleMessage: $("#ms").value.trim()
        });
      };
    }

    const fnt = $("#fnt");
    if (fnt) {
      fnt.onsubmit = e => {
        e.preventDefault();
        go({
          status: appStatus,
          internalNote: $("#nt").value.trim()
        });
      };
    }

    const fct = $("#fct");
    if (fct) {
      fct.onsubmit = e => {
        e.preventDefault();
        go({
          status: appStatus,
          contact: {
            type: $("#ct").value,
            outcome: $("#co").value.trim()
          }
        });
      };
    }
  };

  draw();
}

/* ===== Main Initializer ===== */
document.addEventListener("DOMContentLoaded", () => {
  // Check Admin Page Protection
  if (document.body.hasAttribute("data-admin")) {
    const token = getAdminToken();
    if (!token && !isMockMode()) {
      sessionStorage.setItem("admin_redirect", window.location.pathname + window.location.search);
      window.location.replace("admin-login.html");
      return;
    }
  }

  bgLayer();
  initInteractiveEffects();
  initScrollFeatures();
  shell();
  reveal();

  const P = {
    index: pHome,
    programmes: pProgrammes,
    apply: pApply,
    "application-success": pSuccess,
    "track-status": pTrack,
    "admin-login": pLogin,
    "admin-dashboard": pDash,
    "admin-applications": pApps,
    "admin-application-detail": pDetail
  };

  const handler = P[document.body.dataset.page];
  if (handler) handler();
});
