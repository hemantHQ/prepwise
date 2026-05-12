const state = {
  token: localStorage.getItem("token"),
  user: JSON.parse(localStorage.getItem("user") || "null"),
  theme: localStorage.getItem("theme") || "system",
  apiBaseUrl: (window.APP_CONFIG?.API_BASE_URL || "http://localhost:5000").replace(/\/$/, ""),
  backendReady: false,
  authMode: "login",
  interviews: [],
  analytics: { total: 0, completed: 0, averageScore: 0, labels: [], scores: [] },
  activeInterview: null,
  questionIndex: 0
};

const els = {
  authView: document.querySelector("#authView"),
  views: document.querySelectorAll(".view"),
  navItems: document.querySelectorAll(".nav-item"),
  workspaceNav: document.querySelector("#workspaceNav"),
  logoutBtn: document.querySelector("#logoutBtn"),
  showLogin: document.querySelector("#showLogin"),
  showSignup: document.querySelector("#showSignup"),
  authForm: document.querySelector("#authForm"),
  nameField: document.querySelector("#nameField"),
  nameInput: document.querySelector("#nameInput"),
  emailInput: document.querySelector("#emailInput"),
  passwordInput: document.querySelector("#passwordInput"),
  authMessage: document.querySelector("#authMessage"),
  authCard: document.querySelector(".auth-card"),
  authTitle: document.querySelector("#authTitle"),
  authSubtitle: document.querySelector("#authSubtitle"),
  welcomeTitle: document.querySelector("#welcomeTitle"),
  setupForm: document.querySelector("#setupForm"),
  setupMessage: document.querySelector("#setupMessage"),
  questionText: document.querySelector("#questionText"),
  questionCounter: document.querySelector("#questionCounter"),
  answerInput: document.querySelector("#answerInput"),
  answerFeedback: document.querySelector("#answerFeedback"),
  submitAnswerBtn: document.querySelector("#submitAnswerBtn"),
  finishInterviewBtn: document.querySelector("#finishInterviewBtn"),
  sessionTitle: document.querySelector("#sessionTitle"),
  historyList: document.querySelector("#historyList"),
  latestFeedback: document.querySelector("#latestFeedback"),
  totalSessions: document.querySelector("#totalSessions"),
  completedSessions: document.querySelector("#completedSessions"),
  averageScore: document.querySelector("#averageScore"),
  scoreChart: document.querySelector("#scoreChart"),
  serverWakeOverlay: document.querySelector("#serverWakeOverlay"),
  serverWakeMessage: document.querySelector("#serverWakeMessage"),
  themeToggle: document.querySelector("#themeToggle"),
  themeToggleText: document.querySelector("#themeToggleText")
};

const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

function getActiveTheme() {
  if (state.theme === "system") {
    return systemTheme.matches ? "dark" : "light";
  }
  return state.theme;
}

function applyTheme() {
  const activeTheme = getActiveTheme();
  document.documentElement.dataset.theme = activeTheme;
  els.themeToggle.setAttribute("aria-pressed", String(activeTheme === "dark"));
  els.themeToggle.setAttribute("aria-label", activeTheme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  els.themeToggleText.textContent = activeTheme === "dark" ? "Dark" : "Light";
  if (els.scoreChart) drawChart();
}

function toggleTheme() {
  const nextTheme = getActiveTheme() === "dark" ? "light" : "dark";
  state.theme = nextTheme;
  localStorage.setItem("theme", nextTheme);
  applyTheme();
}

function setWakeState(visible, message) {
  els.serverWakeOverlay.classList.toggle("hidden", !visible);
  if (message) els.serverWakeMessage.textContent = message;
}

async function checkBackendHealth(timeoutMs = 3500) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${state.apiBaseUrl}/api/health`, {
      cache: "no-store",
      signal: controller.signal
    });
    return response.ok;
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForBackend() {
  if (state.backendReady) return;

  if (await checkBackendHealth()) {
    state.backendReady = true;
    setWakeState(false);
    return;
  }

  setWakeState(true, "Backend is not responding yet. Render may be waking the service after inactivity.");
  const startedAt = Date.now();
  const maxWaitMs = 90000;
  let attempt = 0;

  while (Date.now() - startedAt < maxWaitMs) {
    attempt += 1;
    if (await checkBackendHealth(6000)) {
      state.backendReady = true;
      setWakeState(false);
      return;
    }

    const seconds = Math.ceil((Date.now() - startedAt) / 1000);
    setWakeState(true, `Still connecting to the backend... ${seconds}s elapsed. This can take up to a minute after sleep.`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(1800 + attempt * 250, 4500)));
  }

  setWakeState(false);
  throw new Error("Backend is taking too long to respond. Please try again in a moment.");
}

async function api(path, options = {}) {
  await waitForBackend();
  const headers = options.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(`${state.apiBaseUrl}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Request failed.");
  return data;
}

function setAuthMode(mode) {
  state.authMode = mode;
  els.authCard.classList.add("switching");
  els.showLogin.classList.toggle("active", mode === "login");
  els.showSignup.classList.toggle("active", mode === "signup");
  els.nameField.classList.toggle("hidden", mode === "login");
  els.authForm.querySelector(".primary-button").textContent = mode === "login" ? "Sign in" : "Create account";
  els.authTitle.textContent = mode === "login" ? "Welcome back" : "Create your account";
  els.authSubtitle.textContent =
    mode === "login"
      ? "Sign in to continue practicing with your saved interview history."
      : "Start a practice space that remembers your interviews, feedback, and progress.";
  els.authMessage.textContent = "";
  window.setTimeout(() => els.authCard.classList.remove("switching"), 180);
}

function showView(viewId) {
  const loggedIn = Boolean(state.token);
  els.authView.classList.toggle("hidden", loggedIn);
  els.views.forEach((view) => view.classList.toggle("hidden", view.id !== viewId || !loggedIn));
  els.navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  els.workspaceNav.classList.toggle("hidden", !loggedIn);
  els.logoutBtn.classList.toggle("hidden", !loggedIn);
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
}

function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  showView("dashboardView");
}

async function loadDashboard() {
  if (!state.token) return;
  const data = await api("/api/interviews");
  state.interviews = data.interviews;
  state.analytics = data.analytics;
  renderDashboard();
  renderHistory();
}

function renderDashboard() {
  els.welcomeTitle.textContent = `Welcome back${state.user?.name ? `, ${state.user.name}` : ""}`;
  els.totalSessions.textContent = state.analytics.total;
  els.completedSessions.textContent = state.analytics.completed;
  els.averageScore.textContent = state.analytics.averageScore;

  const latest = state.interviews.find((item) => item.finalReport);
  if (!latest) {
    els.latestFeedback.innerHTML = '<p class="form-message">No completed interview yet.</p>';
  } else {
    const report = latest.finalReport;
    els.latestFeedback.innerHTML = [
      `<div class="feedback-chip"><strong>${latest.role}</strong><span>Overall score ${report.overallScore}</span></div>`,
      ...((report.improvementTips || []).slice(0, 4).map((tip) => `<div class="feedback-chip"><span>${tip}</span></div>`))
    ].join("");
  }

  drawChart();
}

function drawChart() {
  const canvas = els.scoreChart;
  const ctx = canvas.getContext("2d");
  const styles = getComputedStyle(document.documentElement);
  const chartBg = styles.getPropertyValue("--chart-bg").trim();
  const chartGrid = styles.getPropertyValue("--chart-grid").trim();
  const muted = styles.getPropertyValue("--muted").trim();
  const primary = styles.getPropertyValue("--primary").trim();
  const accent = styles.getPropertyValue("--accent").trim();
  const ink = styles.getPropertyValue("--ink").trim();
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = chartBg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = chartGrid;
  ctx.lineWidth = 1;

  for (let i = 0; i < 5; i += 1) {
    const y = 30 + i * 48;
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(width - 20, y);
    ctx.stroke();
  }

  const scores = state.analytics.scores || [];
  if (!scores.length) {
    ctx.fillStyle = muted;
    ctx.font = "700 18px system-ui";
    ctx.fillText("Complete an interview to see progress.", 52, height / 2);
    return;
  }

  const gap = (width - 90) / Math.max(1, scores.length - 1);
  const points = scores.map((score, index) => ({
    x: 50 + index * gap,
    y: height - 36 - (Math.min(100, score) / 100) * (height - 70),
    score
  }));

  ctx.strokeStyle = primary;
  ctx.lineWidth = 4;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  points.forEach((point) => {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.font = "800 13px system-ui";
    ctx.fillText(point.score, point.x - 8, point.y - 14);
  });
}

function renderHistory() {
  if (!state.interviews.length) {
    els.historyList.innerHTML = '<p class="form-message">No interviews yet.</p>';
    return;
  }

  els.historyList.innerHTML = state.interviews.map((item) => {
    const date = new Date(item.createdAt).toLocaleDateString();
    const score = item.finalReport?.overallScore ?? "In progress";
    return `
      <article class="history-item">
        <strong>${item.role} - ${item.type}</strong>
        <span>${item.experience} - ${date} - Score: ${score}</span>
        <span>${item.answers.length} answer${item.answers.length === 1 ? "" : "s"} saved</span>
      </article>
    `;
  }).join("");
}

function renderQuestion() {
  const interview = state.activeInterview;
  const total = interview.questions.length;
  const current = interview.questions[state.questionIndex];
  els.sessionTitle.textContent = `${interview.role} - ${interview.type}`;
  els.questionText.textContent = current;
  els.questionCounter.textContent = `${state.questionIndex + 1} / ${total}`;
  els.answerInput.value = "";
  els.answerFeedback.classList.add("hidden");
  els.answerFeedback.innerHTML = "";
}

function renderFeedback(feedback) {
  els.answerFeedback.classList.remove("hidden");
  els.answerFeedback.innerHTML = `
    <h3>Feedback score: ${feedback.score}</h3>
    <p>${feedback.summary || "Answer evaluated successfully."}</p>
    <div class="score-line">
      <div class="score-box"><span>Confidence</span><strong>${feedback.confidence}</strong></div>
      <div class="score-box"><span>Clarity</span><strong>${feedback.clarity}</strong></div>
      <div class="score-box"><span>Accuracy</span><strong>${feedback.technicalAccuracy}</strong></div>
      <div class="score-box"><span>Communication</span><strong>${feedback.communication}</strong></div>
    </div>
    <div class="feedback-list">
      ${(feedback.strengths || []).map((item) => `<div class="feedback-chip"><strong>Strength</strong><span>${item}</span></div>`).join("")}
      ${(feedback.improvementTips || []).map((item) => `<div class="feedback-chip"><strong>Improve</strong><span>${item}</span></div>`).join("")}
    </div>
  `;
}

async function finishInterview() {
  if (!state.activeInterview) return;
  await api(`/api/interviews/${state.activeInterview._id}/complete`, { method: "POST" });
  state.activeInterview = null;
  await loadDashboard();
  showView("dashboardView");
}

els.showLogin.addEventListener("click", () => setAuthMode("login"));
els.showSignup.addEventListener("click", () => setAuthMode("signup"));

document.querySelectorAll("[data-auth-target]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authTarget));
});

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.authMessage.textContent = "Working...";
  const payload = {
    name: els.nameInput.value.trim(),
    email: els.emailInput.value.trim(),
    password: els.passwordInput.value
  };
  const path = state.authMode === "login" ? "/api/auth/login" : "/api/auth/register";

  try {
    const data = await api(path, { method: "POST", body: JSON.stringify(payload) });
    saveSession(data.token, data.user);
    await loadDashboard();
    showView("dashboardView");
  } catch (error) {
    els.authMessage.textContent = error.message;
  }
});

els.setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.setupMessage.textContent = "Generating questions...";
  const formData = new FormData();
  formData.append("role", document.querySelector("#roleInput").value.trim());
  formData.append("experience", document.querySelector("#experienceInput").value);
  formData.append("type", document.querySelector("#typeInput").value);
  formData.append("skills", document.querySelector("#skillsInput").value.trim());
  const resume = document.querySelector("#resumeInput").files[0];
  if (resume) formData.append("resume", resume);

  try {
    const data = await api("/api/interviews", { method: "POST", body: formData });
    state.activeInterview = data.interview;
    state.questionIndex = 0;
    els.setupMessage.textContent = "";
    showView("interviewView");
    renderQuestion();
  } catch (error) {
    els.setupMessage.textContent = error.message;
  }
});

els.submitAnswerBtn.addEventListener("click", async () => {
  const answer = els.answerInput.value.trim();
  if (!answer) {
    els.answerFeedback.classList.remove("hidden");
    els.answerFeedback.innerHTML = '<p class="form-message">Please type an answer before submitting.</p>';
    return;
  }

  els.submitAnswerBtn.disabled = true;
  els.submitAnswerBtn.textContent = "Evaluating...";
  try {
    const data = await api(`/api/interviews/${state.activeInterview._id}/answer`, {
      method: "POST",
      body: JSON.stringify({ questionIndex: state.questionIndex, answer })
    });
    renderFeedback(data.feedback);
    if (state.questionIndex < state.activeInterview.questions.length - 1) {
      state.questionIndex += 1;
      setTimeout(renderQuestion, 1200);
    } else {
      setTimeout(finishInterview, 1400);
    }
  } catch (error) {
    els.answerFeedback.classList.remove("hidden");
    els.answerFeedback.innerHTML = `<p class="form-message">${error.message}</p>`;
  } finally {
    els.submitAnswerBtn.disabled = false;
    els.submitAnswerBtn.textContent = "Submit answer";
  }
});

els.finishInterviewBtn.addEventListener("click", finishInterview);
els.logoutBtn.addEventListener("click", clearSession);
els.themeToggle.addEventListener("click", toggleTheme);

systemTheme.addEventListener("change", () => {
  if (state.theme === "system") applyTheme();
});

els.navItems.forEach((item) => {
  item.addEventListener("click", () => showView(item.dataset.view));
});

document.querySelectorAll("[data-view-target]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.viewTarget));
});

applyTheme();
setAuthMode("login");
if (state.token) {
  loadDashboard()
    .then(() => showView("dashboardView"))
    .catch((error) => {
      els.authMessage.textContent = error.message;
      clearSession();
    });
} else {
  showView("dashboardView");
}
