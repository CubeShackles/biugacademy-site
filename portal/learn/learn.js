"use strict";

// Every user-facing string exists in Portuguese (PT-AO), US English and France
// French. The page never mixes languages: a missing translation is a bug that
// the locale test catches, not a fallback to another language.
const LANGS = ["pt", "en", "fr"];
const LOCALE_TAG = { pt: "pt-AO", en: "en-US", fr: "fr-FR" };
const requestedLang = new URLSearchParams(window.location.search).get("lang");
const lang = LANGS.includes(requestedLang) ? requestedLang : "pt";
const localeTag = LOCALE_TAG[lang];
const text = (pt, en, fr) => ({ pt, en, fr })[lang];
const pick = (labels) => labels[lang];
// Reads the field for the active language, e.g. local(course, "title") -> course.title_fr.
const local = (record, field) => record[`${field}_${lang}`];
const ROLE = {
  learner: { pt: "Formando", en: "Learner", fr: "Apprenant" },
  instructor: { pt: "Formador", en: "Instructor", fr: "Formateur" },
  admin: { pt: "Administrador", en: "Administrator", fr: "Administrateur" },
};
const TRACK = {
  developer: { pt: "Programação", en: "Developer", fr: "Développement" },
  nondeveloper: { pt: "Sem programação", en: "Non-developer", fr: "Sans programmation" },
};
const TOOL_STATUS = {
  reference_only: { pt: "Apenas referência", en: "Reference only", fr: "Référence uniquement" },
  not_accessible: { pt: "Não acessível", en: "Not accessible", fr: "Non accessible" },
  unconfigured: { pt: "Não configurado", en: "Not configured", fr: "Non configuré" },
};
// The header logo goes to the public site's homepage in the current language,
// and the footer links to the public privacy notice and terms of use.
// Paths are listed in LANGS order (pt, en, fr).
const PUBLIC_HOME = ["/pt/", "/en/", "/fr/"];
const PUBLIC_LEGAL = {
  privacy: ["/pt/privacidade/", "/en/privacy/", "/fr/confidentialite/"],
  terms: ["/pt/termos/", "/en/terms/", "/fr/conditions-utilisation/"],
};
const publicUrl = (paths) => `https://biugacademy.org${paths[LANGS.indexOf(lang)]}`;

function syncHeaderBrand() {
  const brand = document.querySelector("header.top a.brand");
  if (brand) {
    brand.setAttribute("href", publicUrl(PUBLIC_HOME));
    brand.setAttribute(
      "aria-label",
      text("BIU.G Academy, página inicial", "BIU.G Academy home", "BIU.G Academy, page d’accueil")
    );
  }
  const legal = document.querySelector("footer.foot nav");
  if (legal)
    legal.setAttribute(
      "aria-label",
      text("Informação legal", "Legal information", "Informations légales")
    );
  const links = [
    ["footer.foot a.foot-privacy", "privacy", text("Privacidade", "Privacy", "Confidentialité")],
    [
      "footer.foot a.foot-terms",
      "terms",
      text("Termos de utilização", "Terms of use", "Conditions d’utilisation"),
    ],
  ];
  for (const [selector, key, label] of links) {
    const link = document.querySelector(selector);
    if (!link) continue;
    link.setAttribute("href", publicUrl(PUBLIC_LEGAL[key]));
    link.textContent = label;
  }
}

const labelOf = (map, key) => (map[key] ? pick(map[key]) : key);
const message = (data) =>
  (data && local(data, "message")) ||
  text("Pedido falhou.", "Request failed.", "La demande a échoué.");

const state = {
  status: null,
  account: null,
  cohorts: [],
  tools: [],
  catalog: [],
  accounts: [],
  overview: null,
  compliance: null,
  cohort: null,
  insights: null,
  newsletter: null,
  subscribers: null,
  linkResult: "",
  mfaPending: false,
  mfaEnrollmentRequired: false,
  passwordChangeRequired: false,
  issuedPassword: null,
  security: null,
  sessions: [],
  enrollment: null,
  recoveryCodes: null,
  authView: "login",
  resetToken: "",
  error: "",
  offline: false,
};

function h(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function")
      node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, String(value));
  });
  [].concat(children || []).forEach((child) => {
    if (child == null || child === false) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function field(id, label, type, extra) {
  return [
    h("label", { for: id }, label),
    h("input", Object.assign({ id, name: id, type, required: true }, extra || {})),
  ];
}

async function api(path, options) {
  const opts = options || {};
  const headers = { Accept: "application/json" };
  if (opts.method && opts.method !== "GET") headers["X-BIUG-Client"] = "academy";
  if (opts.body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    method: opts.method || "GET",
    headers,
    credentials: "same-origin",
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_error) {
    data = {
      message_pt: "Resposta inválida.",
      message_en: "Invalid response.",
      message_fr: "Réponse non valide.",
    };
  }
  return { ok: response.ok, status: response.status, data };
}

// Signed-in users in the learning sandbox see one short line. Nothing internal (service
// status, tool configuration, policy notes) is shown on screen.
function notice(status) {
  if (!state.account || !status || !status.synthetic_demo) return null;
  return h(
    "p",
    { class: "sandbox-note", id: "status-banner" },
    text(
      "Ambiente de pré-lançamento com dados sintéticos.",
      "Prelaunch learning sandbox; synthetic data only.",
      "Aperçu de pré-lancement avec des données fictives."
    )
  );
}

function renderError() {
  return state.error ? h("div", { class: "error", id: "error" }, state.error) : null;
}

function renderLogin() {
  const form = h("form", { id: "login-form" }, [
    ...field("login-name", text("Nome de utilizador", "Username", "Nom d’utilisateur"), "text", {
      autocomplete: "username",
      autocapitalize: "none",
    }),
    ...field("password", text("Palavra-passe", "Password", "Mot de passe"), "password", {
      autocomplete: "current-password",
    }),
    h("div", { class: "row" }, [
      h(
        "button",
        { id: "login-submit", type: "submit" },
        text("Entrar", "Sign in", "Se connecter")
      ),
    ]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.error = "";
    const result = await api("/api/auth/login", {
      method: "POST",
      body: {
        login_name: form.querySelector("#login-name").value.trim(),
        password: form.querySelector("#password").value,
      },
    });
    if (!result.ok) {
      state.error = message(result.data);
      render();
      return;
    }
    if (result.data.mfa_required) {
      state.mfaPending = true;
      render();
      return;
    }
    await startSession();
  });
  const lifecycleOpen = state.status && state.status.identity_lifecycle === "synthetic-test";
  const switchView = (view) => () => {
    state.authView = view;
    state.error = "";
    render();
  };
  return h("section", { class: "card login-card", id: "login-card" }, [
    h("img", {
      class: "login-logo",
      src: "/assets/biug-academy-logo-160.png",
      width: "64",
      height: "64",
      alt: "",
    }),
    h("h1", null, text("Entrar", "Sign in", "Se connecter")),
    h(
      "p",
      { class: "muted" },
      text("Área de aprendizagem", "Learning area", "Espace d’apprentissage")
    ),
    state.status && state.status.synthetic_demo
      ? h("span", { class: "pill off" }, text("Pré-lançamento", "Preview", "Aperçu"))
      : null,
    renderError(),
    form,
    lifecycleOpen
      ? h("div", { class: "row auth-links" }, [
          h(
            "button",
            { type: "button", class: "link", onclick: switchView("register") },
            text("Criar conta", "Create account", "Créer un compte")
          ),
          h(
            "button",
            { type: "button", class: "link", onclick: switchView("reset-request") },
            text("Esqueceu a palavra-passe?", "Forgot your password?", "Mot de passe oublié ?")
          ),
        ])
      : null,
  ]);
}

function authCard(id, title, children) {
  return h("section", { class: "card login-card", id }, [
    h("img", {
      class: "login-logo",
      src: "/assets/biug-academy-logo-160.png",
      width: "64",
      height: "64",
      alt: "",
    }),
    h("h1", null, title),
    renderError(),
    ...children,
    h(
      "button",
      {
        type: "button",
        class: "link",
        onclick: async () => {
          // A signed-in session (temporary password) is ended, not left behind.
          if (state.account) await api("/api/auth/logout", { method: "POST" });
          state.account = null;
          state.passwordChangeRequired = false;
          state.authView = "login";
          state.mfaPending = false;
          state.error = "";
          render();
        },
      },
      text("Voltar ao início de sessão", "Back to sign in", "Retour à la connexion")
    ),
  ]);
}

function renderMfaVerify() {
  const form = h("form", { id: "mfa-form" }, [
    ...field("mfa-code", text("Código de 6 dígitos", "6-digit code", "Code à 6 chiffres"), "text", {
      inputmode: "numeric",
      autocomplete: "one-time-code",
      pattern: "[0-9]{6}",
      maxlength: 6,
    }),
    h("div", { class: "row" }, [
      h("button", { type: "submit" }, text("Confirmar", "Confirm", "Confirmer")),
    ]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = form.querySelector("#mfa-code").value.trim();
    const body = /^\d{6}$/.test(value) ? { code: value } : { recovery_code: value };
    const result = await api("/api/auth/mfa/verify", { method: "POST", body });
    if (!result.ok) {
      state.error = message(result.data);
      render();
      return;
    }
    state.mfaPending = false;
    state.error = "";
    await startSession();
  });
  form.querySelector("#mfa-code").removeAttribute("pattern");
  form.querySelector("#mfa-code").setAttribute("maxlength", "16");
  return authCard(
    "mfa-card",
    text("Verificação em dois passos", "Two-step verification", "Validation en deux étapes"),
    [
      h(
        "p",
        { class: "muted" },
        text(
          "Introduza o código da aplicação de autenticação ou um código de recuperação.",
          "Enter the code from your authenticator app or a recovery code.",
          "Saisissez le code de votre application d’authentification ou un code de récupération."
        )
      ),
      form,
    ]
  );
}

function renderRegister() {
  const form = h("form", { id: "register-form" }, [
    ...field("reg-login", text("Nome de utilizador", "Username", "Nom d’utilisateur"), "text", {
      autocapitalize: "none",
      autocomplete: "username",
    }),
    ...field("reg-display", text("Nome visível", "Display name", "Nom affiché"), "text"),
    ...field("reg-email", text("Correio eletrónico", "Email", "Adresse e-mail"), "email", {
      autocomplete: "email",
    }),
    ...field(
      "reg-password",
      text(
        "Palavra-passe (12+ caracteres)",
        "Password (12+ characters)",
        "Mot de passe (12 caractères ou plus)"
      ),
      "password",
      {
        autocomplete: "new-password",
        minlength: 12,
      }
    ),
    h("label", { for: "reg-locale" }, text("Língua", "Language", "Langue")),
    h("select", { id: "reg-locale" }, [
      h("option", { value: "pt" }, "Português"),
      h("option", { value: "en" }, "English"),
      h("option", { value: "fr" }, "Français"),
    ]),
    h("label", { class: "check" }, [
      h("input", { id: "reg-age", type: "checkbox", required: true }),
      text("Tenho 18 anos ou mais.", "I am 18 or older.", "J’ai 18 ans ou plus."),
    ]),
    h("label", { class: "check" }, [
      h("input", { id: "reg-terms", type: "checkbox", required: true }),
      text(
        "Li e aceito os termos e o aviso de privacidade.",
        "I have read and accept the terms and the privacy notice.",
        "J’ai lu et j’accepte les conditions et la notice de confidentialité."
      ),
    ]),
    h("div", { class: "row" }, [
      h("button", { type: "submit" }, text("Criar conta", "Create account", "Créer un compte")),
    ]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api("/api/auth/register", {
      method: "POST",
      body: {
        login_name: form.querySelector("#reg-login").value.trim(),
        display_name: form.querySelector("#reg-display").value.trim(),
        email: form.querySelector("#reg-email").value.trim(),
        password: form.querySelector("#reg-password").value,
        locale: form.querySelector("#reg-locale").value,
        age_attested_18: form.querySelector("#reg-age").checked === true,
        terms_version: state.status.terms_version || "2026-11-draft-1",
      },
    });
    state.error = result.ok ? "" : message(result.data);
    if (result.ok) {
      state.authView = "login";
      state.linkResult = text(
        "Se os dados estiverem corretos, enviámos uma ligação de confirmação para o seu correio eletrónico.",
        "If the details are valid, we sent a confirmation link to your email.",
        "Si les informations sont valides, nous avons envoyé un lien de confirmation à votre adresse e-mail."
      );
    }
    render();
  });
  return authCard("register-card", text("Criar conta", "Create account", "Créer un compte"), [
    form,
  ]);
}

function renderResetRequest() {
  const form = h("form", { id: "reset-request-form" }, [
    ...field("reset-email", text("Correio eletrónico", "Email", "Adresse e-mail"), "email", {
      autocomplete: "email",
    }),
    h("div", { class: "row" }, [
      h("button", { type: "submit" }, text("Enviar ligação", "Send link", "Envoyer le lien")),
    ]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api("/api/auth/password-reset/request", {
      method: "POST",
      body: { email: form.querySelector("#reset-email").value.trim() },
    });
    state.error = result.ok ? "" : message(result.data);
    if (result.ok) {
      state.authView = "login";
      state.linkResult = text(
        "Se o endereço tiver uma conta verificada, enviámos uma ligação válida durante 30 minutos.",
        "If the address has a verified account, we sent a link valid for 30 minutes.",
        "Si l’adresse correspond à un compte vérifié, nous avons envoyé un lien valable 30 minutes."
      );
    }
    render();
  });
  return authCard(
    "reset-request-card",
    text("Recuperar palavra-passe", "Recover password", "Récupérer le mot de passe"),
    [form]
  );
}

function renderResetComplete() {
  const form = h("form", { id: "reset-complete-form" }, [
    ...field(
      "reset-password",
      text(
        "Nova palavra-passe (12+ caracteres)",
        "New password (12+ characters)",
        "Nouveau mot de passe (12 caractères ou plus)"
      ),
      "password",
      {
        autocomplete: "new-password",
        minlength: 12,
      }
    ),
    h("div", { class: "row" }, [
      h("button", { type: "submit" }, text("Guardar", "Save", "Enregistrer")),
    ]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api("/api/auth/password-reset/complete", {
      method: "POST",
      body: { token: state.resetToken, password: form.querySelector("#reset-password").value },
    });
    state.error = result.ok ? "" : message(result.data);
    if (result.ok) {
      state.resetToken = "";
      state.authView = "login";
      state.linkResult = text(
        "Palavra-passe alterada. Todas as sessões foram terminadas.",
        "Password changed. All sessions were signed out.",
        "Mot de passe modifié. Toutes les sessions ont été fermées."
      );
    }
    render();
  });
  return authCard(
    "reset-complete-card",
    text("Nova palavra-passe", "New password", "Nouveau mot de passe"),
    [form]
  );
}

async function loadSecurity() {
  const [security, sessions] = await Promise.all([
    api("/api/auth/security"),
    api("/api/auth/sessions"),
  ]);
  state.security = security.ok ? security.data : null;
  state.sessions = sessions.ok ? sessions.data.sessions || [] : [];
}

function renderSecurity() {
  const sec = state.security;
  if (!sec) return null;
  const parts = [];
  if (state.mfaEnrollmentRequired) {
    parts.push(
      h(
        "p",
        { class: "error", id: "mfa-enrollment-required" },
        text(
          "A sua função exige verificação em dois passos. Ative-a para continuar.",
          "Your role requires two-step verification. Turn it on to continue.",
          "Votre rôle exige la validation en deux étapes. Activez-la pour continuer."
        )
      )
    );
  }
  parts.push(
    h("p", null, [
      text(
        "Verificação em dois passos: ",
        "Two-step verification: ",
        "Validation en deux étapes : "
      ),
      h(
        "span",
        { class: `pill ${sec.mfa_enabled ? "ok" : "off"}` },
        sec.mfa_enabled ? text("Ativa", "On", "Activée") : text("Desativada", "Off", "Désactivée")
      ),
      sec.mfa_required
        ? ` ${text("(obrigatória para a sua função)", "(required for your role)", "(obligatoire pour votre rôle)")}`
        : "",
    ])
  );
  if (state.recoveryCodes) {
    parts.push(
      h("div", { class: "recovery", id: "recovery-codes" }, [
        h(
          "p",
          null,
          text(
            "Guarde estes códigos de recuperação num local seguro. Cada um funciona uma vez e não voltam a ser mostrados.",
            "Store these recovery codes somewhere safe. Each works once and they will not be shown again.",
            "Conservez ces codes de récupération en lieu sûr. Chacun ne fonctionne qu’une fois et ils ne seront plus affichés."
          )
        ),
        h(
          "ol",
          null,
          state.recoveryCodes.map((c) => h("li", null, h("code", null, c)))
        ),
        h(
          "button",
          {
            type: "button",
            class: "secondary",
            onclick: () => {
              state.recoveryCodes = null;
              render();
            },
          },
          text("Já guardei os códigos", "I have saved the codes", "J’ai conservé les codes")
        ),
      ])
    );
  } else if (!sec.mfa_enabled && !state.enrollment) {
    parts.push(
      h(
        "button",
        {
          type: "button",
          id: "mfa-enroll",
          onclick: async () => {
            const result = await api("/api/auth/mfa/enroll", { method: "POST", body: {} });
            state.error = result.ok ? "" : message(result.data);
            state.enrollment = result.ok ? result.data : null;
            render();
          },
        },
        text(
          "Configurar verificação em dois passos",
          "Set up two-step verification",
          "Configurer la validation en deux étapes"
        )
      )
    );
  } else if (state.enrollment) {
    const form = h("form", { id: "mfa-activate" }, [
      h(
        "p",
        { class: "muted" },
        text(
          "Adicione esta conta na aplicação de autenticação com a chave abaixo e introduza o código que ela mostrar.",
          "Add this account to your authenticator app with the key below, then enter the code it shows.",
          "Ajoutez ce compte à votre application d’authentification avec la clé ci-dessous, puis saisissez le code affiché."
        )
      ),
      h("p", null, h("code", { class: "secret", id: "mfa-secret" }, state.enrollment.secret)),
      h("details", null, [
        h("summary", null, text("Ligação de configuração", "Setup link", "Lien de configuration")),
        h("p", null, h("code", { class: "secret" }, state.enrollment.otpauth_uri)),
      ]),
      ...field(
        "mfa-activate-code",
        text("Código de 6 dígitos", "6-digit code", "Code à 6 chiffres"),
        "text",
        {
          inputmode: "numeric",
          autocomplete: "one-time-code",
          maxlength: 6,
        }
      ),
      h("div", { class: "row" }, [
        h("button", { type: "submit" }, text("Ativar", "Turn on", "Activer")),
      ]),
    ]);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await api("/api/auth/mfa/activate", {
        method: "POST",
        body: { code: form.querySelector("#mfa-activate-code").value.trim() },
      });
      state.error = result.ok ? "" : message(result.data);
      if (result.ok) {
        state.enrollment = null;
        state.recoveryCodes = result.data.recovery_codes;
        state.mfaEnrollmentRequired = false;
        await loadHome();
        return;
      }
      render();
    });
    parts.push(form);
  }

  const pw = h("form", { id: "change-password" }, [
    ...field(
      "current-password",
      text("Palavra-passe atual", "Current password", "Mot de passe actuel"),
      "password",
      {
        autocomplete: "current-password",
      }
    ),
    ...field(
      "new-password-own",
      text(
        "Nova palavra-passe (12+ caracteres)",
        "New password (12+ characters)",
        "Nouveau mot de passe (12 caractères ou plus)"
      ),
      "password",
      {
        autocomplete: "new-password",
        minlength: 12,
      }
    ),
    h("div", { class: "row" }, [
      h(
        "button",
        { type: "submit", class: "secondary" },
        text("Alterar palavra-passe", "Change password", "Modifier le mot de passe")
      ),
    ]),
  ]);
  pw.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api("/api/auth/password", {
      method: "POST",
      body: {
        current_password: pw.querySelector("#current-password").value,
        new_password: pw.querySelector("#new-password-own").value,
      },
    });
    if (!result.ok) {
      state.error = message(result.data);
      render();
      return;
    }
    state.account = null;
    state.linkResult = text(
      "Palavra-passe alterada. Inicie sessão de novo.",
      "Password changed. Sign in again.",
      "Mot de passe modifié. Reconnectez-vous."
    );
    render();
  });

  parts.push(
    h("details", null, [
      h("summary", null, text("Sessões", "Sessions", "Sessions")),
      h(
        "ul",
        { class: "session-list" },
        state.sessions.map((sess) =>
          h("li", null, [
            `${new Date(sess.created_at || sess.expires_at).toLocaleString(localeTag)}`,
            sess.current ? ` · ${text("esta sessão", "this session", "cette session")}` : "",
            sess.revoked_at ? ` · ${text("terminada", "ended", "terminée")}` : "",
          ])
        )
      ),
      h(
        "button",
        {
          type: "button",
          class: "secondary",
          onclick: async () => {
            await api("/api/auth/sessions/revoke-all", { method: "POST", body: {} });
            state.account = null;
            render();
          },
        },
        text("Terminar todas as sessões", "Sign out everywhere", "Se déconnecter partout")
      ),
    ]),
    h("details", null, [h("summary", null, text("Palavra-passe", "Password", "Mot de passe")), pw])
  );
  return h("section", { class: "panel", id: "account-security" }, [
    h("h2", null, text("Segurança da conta", "Account security", "Sécurité du compte")),
    ...parts,
  ]);
}

function cohortButton(cohort) {
  return h(
    "button",
    {
      class: "secondary",
      type: "button",
      onclick: () => openCohort(cohort.id),
    },
    `${cohort.name} · ${labelOf(TRACK, cohort.track)}`
  );
}

function renderTools() {
  return h("section", { class: "panel", id: "tool-list" }, [
    h("h2", null, text("Ferramentas CubeShackles", "CubeShackles tools", "Outils CubeShackles")),
    h(
      "p",
      { class: "muted" },
      text(
        "Nenhum adaptador pode ser chamado. Referências públicas não são uma sessão nem uma API.",
        "No adapter is callable. Public references are not a session or an API.",
        "Aucun connecteur ne peut être appelé. Les références publiques ne sont ni une session ni une API."
      )
    ),
    ...state.tools.map((adapter) =>
      h("article", { class: "card" }, [
        h("h3", null, local(adapter, "label")),
        h("span", { class: "pill off" }, labelOf(TOOL_STATUS, adapter.status)),
        h("p", null, local(adapter, "detail")),
        adapter.evidence_url
          ? h(
              "a",
              { href: adapter.evidence_url, rel: "noreferrer" },
              text("Abrir documento público", "Open public document", "Ouvrir le document public")
            )
          : h(
              "p",
              { class: "muted" },
              text("Sem URL verificada.", "No verified URL.", "Aucune URL vérifiée.")
            ),
        adapter.kind === "http_api"
          ? h(
              "button",
              {
                type: "button",
                id: "try-tool-call",
                class: "secondary",
                onclick: async () => {
                  const result = await api(`/api/tools/${adapter.id}/call`, {
                    method: "POST",
                    body: {},
                  });
                  state.error = message(result.data);
                  render();
                },
              },
              text("Tentar chamada", "Try call", "Essayer l’appel")
            )
          : null,
      ])
    ),
  ]);
}

function renderBadges(badges) {
  return h("div", { id: "badge-list" }, [
    h("h3", null, text("Distintivos", "Badges", "Badges")),
    ...(badges || []).map((badge) =>
      h(
        "span",
        { class: badge.earned ? "pill ok" : "pill off" },
        `${local(badge, "title")}: ${
          badge.earned
            ? text("conquistado", "earned", "obtenu")
            : text("por concluir", "not earned", "à obtenir")
        }`
      )
    ),
  ]);
}

function renderInsights() {
  const insights = state.insights;
  if (!insights) return null;
  if (insights.scope === "self") {
    const rate =
      insights.module_count > 0
        ? `${insights.my_completed}/${insights.module_count}`
        : text("sem módulos", "no modules", "aucun module");
    return h("section", { class: "panel", id: "insights" }, [
      h("h2", null, text("O meu progresso", "My progress", "Ma progression")),
      h("div", { class: "metrics" }, [
        h("div", { class: "metric" }, [
          text("Concluídos", "Completed", "Terminés"),
          h("strong", null, rate),
        ]),
        h("div", { class: "metric" }, [
          text("Próximo", "Next", "Suivant"),
          h("strong", null, insights.next_module ? local(insights.next_module, "title") : "—"),
        ]),
      ]),
      renderBadges(insights.badges),
    ]);
  }
  const rate =
    insights.possible_completions > 0
      ? `${insights.completed_count}/${insights.possible_completions}`
      : text("sem dados", "no data", "aucune donnée");
  return h("section", { class: "panel", id: "insights" }, [
    h("h2", null, text("Leitura da turma", "Cohort insight", "Vue de la cohorte")),
    h("div", { class: "metrics" }, [
      h("div", { class: "metric" }, [
        text("Formandos", "Learners", "Apprenants"),
        h("strong", null, String(insights.learner_count)),
      ]),
      h("div", { class: "metric" }, [
        text("Conclusões", "Completions", "Modules terminés"),
        h("strong", null, rate),
      ]),
    ]),
    h(
      "ul",
      null,
      (insights.modules || []).map((mod) =>
        h("li", null, `${local(mod, "title")}: ${mod.completed_count}`)
      )
    ),
    h("h3", null, text("Sem progresso ainda", "No progress yet", "Pas encore de progression")),
    (insights.stalled_learners || []).length
      ? h(
          "ul",
          null,
          insights.stalled_learners.map((person) => h("li", null, person.display_name))
        )
      : h(
          "p",
          { class: "muted" },
          text("Ninguém nesta lista.", "Nobody on this list.", "Personne dans cette liste.")
        ),
  ]);
}

function renderModules() {
  const detail = state.cohort;
  if (!detail) return null;
  const learner = detail.membership_role === "learner";
  const blocks = [];
  (detail.courses || []).forEach((course) => {
    blocks.push(h("h3", null, local(course, "title")));
    course.modules.forEach((mod) => {
      const form = h("form", { id: `module-${mod.id}` }, [
        h("p", null, local(mod, "summary")),
        ...(mod.exercise.items || []).map((item) =>
          h("label", { class: "check" }, [
            h("input", { type: "checkbox", value: item.id, disabled: mod.completed ? true : null }),
            local(item, "label"),
          ])
        ),
        learner && !mod.completed
          ? h("div", { class: "row" }, [
              h(
                "button",
                {
                  type: "submit",
                  id: mod.id === detail.courses[0].modules[0].id ? "complete-module" : null,
                },
                text("Concluir módulo", "Complete module", "Terminer le module")
              ),
            ])
          : h(
              "p",
              { class: "muted" },
              mod.completed
                ? text(
                    "Concluído no servidor.",
                    "Completed on the server.",
                    "Terminé sur le serveur."
                  )
                : text(
                    "Só o formando marca o próprio progresso.",
                    "Only the learner records their own progress.",
                    "Seul l’apprenant enregistre sa propre progression."
                  )
            ),
      ]);
      if (learner && !mod.completed) {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const checklist = [...form.querySelectorAll("input:checked")].map((input) => input.value);
          const result = await api(`/api/cohorts/${detail.cohort.id}/modules/${mod.id}/complete`, {
            method: "POST",
            body: { checklist },
          });
          if (!result.ok) {
            state.error = message(result.data);
            render();
            return;
          }
          state.error = "";
          state.insights = result.data;
          await openCohort(detail.cohort.id);
        });
      }
      blocks.push(h("article", { class: "card" }, [h("h3", null, local(mod, "title")), form]));
    });
  });
  return h("section", { id: "module-list" }, blocks);
}

function renderAdminTools() {
  if (!state.account || state.account.role !== "admin" || !state.cohort) return null;
  const cohort = state.cohort.cohort;
  const courseForm = h("form", { id: "assign-course" }, [
    h("label", { for: "course-id" }, text("Atribuir curso", "Assign course", "Attribuer un cours")),
    h(
      "select",
      { id: "course-id", name: "course-id", required: true },
      state.catalog
        .filter((course) => course.track === cohort.track)
        .map((course) => h("option", { value: course.id }, local(course, "title")))
    ),
    h("div", { class: "row" }, [
      h("button", { type: "submit" }, text("Atribuir", "Assign", "Attribuer")),
    ]),
  ]);
  courseForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api(`/api/admin/cohorts/${cohort.id}/courses`, {
      method: "POST",
      body: { course_id: courseForm.querySelector("#course-id").value },
    });
    state.error = result.ok ? "" : message(result.data);
    if (result.ok) await openCohort(cohort.id);
    else render();
  });
  const memberForm = h("form", { id: "add-member" }, [
    h("label", { for: "member-id" }, text("Adicionar membro", "Add member", "Ajouter un membre")),
    h(
      "select",
      { id: "member-id", required: true },
      state.accounts.map((account) =>
        h(
          "option",
          { value: account.id },
          `${account.display_name} (${labelOf(ROLE, account.role)})`
        )
      )
    ),
    h(
      "label",
      { for: "member-role" },
      text("Papel na turma", "Role in cohort", "Rôle dans la cohorte")
    ),
    h("select", { id: "member-role" }, [
      h("option", { value: "learner" }, text("Formando", "Learner", "Apprenant")),
      h("option", { value: "instructor" }, text("Formador", "Instructor", "Formateur")),
    ]),
    h("div", { class: "row" }, [
      h("button", { type: "submit" }, text("Adicionar", "Add", "Ajouter")),
    ]),
  ]);
  memberForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api(`/api/admin/cohorts/${cohort.id}/members`, {
      method: "POST",
      body: {
        account_id: memberForm.querySelector("#member-id").value,
        membership_role: memberForm.querySelector("#member-role").value,
      },
    });
    state.error = result.ok ? "" : message(result.data);
    render();
  });
  return h("section", { class: "panel" }, [
    h("h2", null, text("Atribuições", "Assignments", "Attributions")),
    courseForm,
    memberForm,
  ]);
}

function renderAdminHome() {
  if (!state.account || state.account.role !== "admin") return null;
  const overview = state.overview;
  const form = h("form", { id: "admin-cohort-form" }, [
    ...field("cohort-name", text("Nome da turma", "Cohort name", "Nom de la cohorte"), "text"),
    ...field(
      "cohort-slug",
      text("Identificador da turma", "Cohort identifier", "Identifiant de la cohorte"),
      "text",
      {
        autocapitalize: "none",
      }
    ),
    h("label", { for: "cohort-track" }, text("Percurso", "Track", "Parcours")),
    h("select", { id: "cohort-track" }, [
      h("option", { value: "developer" }, labelOf(TRACK, "developer")),
      h("option", { value: "nondeveloper" }, labelOf(TRACK, "nondeveloper")),
    ]),
    h("div", { class: "row" }, [
      h("button", { type: "submit" }, text("Criar turma", "Create cohort", "Créer la cohorte")),
    ]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api("/api/admin/cohorts", {
      method: "POST",
      body: {
        name: form.querySelector("#cohort-name").value.trim(),
        slug: form.querySelector("#cohort-slug").value.trim(),
        track: form.querySelector("#cohort-track").value,
        summary: "",
      },
    });
    if (!result.ok) {
      state.error = message(result.data);
      render();
      return;
    }
    state.error = "";
    await loadHome();
    await openCohort(result.data.cohort.id);
  });
  const syntheticForm = h("form", { id: "synthetic-account-form" }, [
    h(
      "p",
      { class: "muted" },
      text(
        "Criação sintética local, se o servidor a permitir. Não há campo para contacto, telefone ou nome legal.",
        "Local synthetic creation, if the server allows it. There is no email, phone, or legal-name field.",
        "Création fictive locale, si le serveur l’autorise. Il n’y a aucun champ pour l’adresse e-mail, le téléphone ou le nom légal."
      )
    ),
    ...field("new-login", text("Nome de utilizador", "Username", "Nom d’utilisateur"), "text", {
      autocapitalize: "none",
    }),
    ...field("new-display", text("Nome visível", "Display name", "Nom affiché"), "text"),
    ...field("new-password", text("Palavra-passe", "Password", "Mot de passe"), "password", {
      autocomplete: "new-password",
      minlength: 12,
    }),
    h("label", { for: "new-role" }, text("Papel", "Role", "Rôle")),
    h("select", { id: "new-role" }, [
      h("option", { value: "learner" }, labelOf(ROLE, "learner")),
      h("option", { value: "instructor" }, labelOf(ROLE, "instructor")),
      h("option", { value: "admin" }, labelOf(ROLE, "admin")),
    ]),
    h("label", { class: "check" }, [
      h("input", { id: "age-18", type: "checkbox" }),
      text(
        "Confirmo que esta conta sintética representa uma pessoa com 18 anos ou mais.",
        "I confirm this synthetic account represents a person aged 18 or older.",
        "Je confirme que ce compte fictif représente une personne de 18 ans ou plus."
      ),
    ]),
    h("div", { class: "row" }, [
      h(
        "button",
        { type: "submit" },
        text("Criar conta sintética", "Create synthetic account", "Créer un compte fictif")
      ),
    ]),
  ]);
  syntheticForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api("/api/admin/accounts", {
      method: "POST",
      body: {
        login_name: syntheticForm.querySelector("#new-login").value.trim(),
        display_name: syntheticForm.querySelector("#new-display").value.trim(),
        password: syntheticForm.querySelector("#new-password").value,
        role: syntheticForm.querySelector("#new-role").value,
        age_attested_18: syntheticForm.querySelector("#age-18").checked === true,
      },
    });
    state.error = result.ok ? "" : message(result.data);
    if (result.ok) await loadHome();
    else render();
  });
  const mode = state.status ? state.status.account_provisioning : "closed";
  const accountForm =
    mode === "production-admin"
      ? renderLearnerProvisioning()
      : mode === "synthetic-local"
        ? syntheticForm
        : null;
  return h("section", { class: "panel", id: "admin-home" }, [
    h("h2", null, text("Operação", "Operations", "Gestion")),
    overview
      ? h("div", { class: "metrics" }, [
          h("div", { class: "metric" }, [
            text("Turmas", "Cohorts", "Cohortes"),
            h("strong", null, String(overview.cohort_count)),
          ]),
          h("div", { class: "metric" }, [
            text("Formandos ativos", "Active learners", "Apprenants actifs"),
            h("strong", null, String(overview.active_accounts.learner)),
          ]),
        ])
      : null,
    form,
    accountForm,
  ]);
}

// Shown once after the server issues a temporary password. It is kept only in
// page memory and cleared when dismissed or on sign-out.
function renderIssuedPassword() {
  const issued = state.issuedPassword;
  if (!issued) return null;
  return h("div", { class: "recovery", id: "issued-password", role: "status" }, [
    h(
      "p",
      null,
      `${text("Palavra-passe temporária de", "Temporary password for", "Mot de passe temporaire de")} ${issued.login}. ${text(
        "Entregue-a à pessoa por um canal seguro; não volta a ser mostrada e tem de ser alterada no primeiro início de sessão.",
        "Give it to the person over a secure channel; it will not be shown again and must be changed at first sign-in.",
        "Remettez-le à la personne par un canal sécurisé ; il ne sera plus affiché et devra être modifié à la première connexion."
      )}`
    ),
    h("p", null, h("code", { class: "secret", id: "issued-password-value" }, issued.password)),
    h(
      "button",
      {
        type: "button",
        class: "secondary",
        onclick: () => {
          state.issuedPassword = null;
          render();
        },
      },
      text("Já entreguei a palavra-passe", "I have handed it over", "J’ai remis le mot de passe")
    ),
  ]);
}

// Production-admin mode: learners only, no password chosen by the administrator,
// no email, phone or legal-name field.
const REFERENCE_KIND = {
  authority: { pt: "Autoridade", en: "Authority", fr: "Autorité" },
  law: { pt: "Lei", en: "Law", fr: "Loi" },
  open_question: { pt: "Questão em aberto", en: "Open question", fr: "Question ouverte" },
};

// Administrator-only. The server refuses the data to every other role; this
// check keeps the panel out of the page even if stale state were present.
function renderComplianceReferences() {
  if (!state.account || state.account.role !== "admin" || !state.compliance) return null;
  const data = state.compliance;
  return h("section", { class: "panel", id: "compliance-references" }, [
    h(
      "h2",
      null,
      text(
        "Conformidade e referências legais",
        "Compliance and legal references",
        "Conformité et références juridiques"
      )
    ),
    h("p", { class: "muted" }, local(data, "disclaimer")),
    h("p", null, [h("span", { class: "pill off" }, local(data, "status"))]),
    h(
      "ul",
      { class: "references" },
      data.references.map((entry) =>
        h("li", { "data-kind": entry.kind }, [
          h("strong", null, `${labelOf(REFERENCE_KIND, entry.kind)}: `),
          entry.source_url
            ? h("a", { href: entry.source_url, rel: "noopener noreferrer" }, entry.name)
            : h("span", null, entry.name),
          h("p", null, local(entry, "summary")),
          entry.source_note_pt ? h("p", { class: "muted" }, local(entry, "source_note")) : null,
          h("p", { class: "muted" }, local(data, "status")),
        ])
      )
    ),
    h(
      "p",
      { class: "muted" },
      `${text("Fontes verificadas em", "Sources checked on", "Sources vérifiées le")} ${data.sources_checked_on}`
    ),
  ]);
}

function renderLearnerProvisioning() {
  const create = h("form", { id: "learner-account-form" }, [
    h(
      "p",
      { class: "muted" },
      text(
        "Criar conta de formando. Só nome de utilizador, nome visível e língua; não há campo para contacto, telefone ou nome legal.",
        "Create a learner account. Username, display name and language only; there is no email, phone or legal-name field.",
        "Créer un compte d’apprenant. Nom d’utilisateur, nom affiché et langue uniquement ; aucun champ pour l’adresse électronique, le téléphone ou le nom légal."
      )
    ),
    ...field("new-login", text("Nome de utilizador", "Username", "Nom d’utilisateur"), "text", {
      autocapitalize: "none",
    }),
    ...field("new-display", text("Nome visível", "Display name", "Nom affiché"), "text"),
    h("label", { for: "new-locale" }, text("Língua", "Language", "Langue")),
    h("select", { id: "new-locale" }, [
      h("option", { value: "pt" }, text("Português", "Portuguese", "Portugais")),
      h("option", { value: "en" }, text("Inglês", "English", "Anglais")),
      h("option", { value: "fr" }, text("Francês", "French", "Français")),
    ]),
    h("label", { class: "check" }, [
      h("input", { id: "age-18", type: "checkbox" }),
      text(
        "Confirmo que esta pessoa tem 18 anos ou mais.",
        "I confirm this person is 18 or older.",
        "Je confirme que cette personne a 18 ans ou plus."
      ),
    ]),
    h("div", { class: "row" }, [
      h(
        "button",
        { type: "submit" },
        text("Criar conta de formando", "Create learner account", "Créer un compte d’apprenant")
      ),
    ]),
  ]);
  create.addEventListener("submit", async (event) => {
    event.preventDefault();
    const loginName = create.querySelector("#new-login").value.trim();
    const result = await api("/api/admin/accounts", {
      method: "POST",
      body: {
        login_name: loginName,
        display_name: create.querySelector("#new-display").value.trim(),
        locale: create.querySelector("#new-locale").value,
        age_attested_18: create.querySelector("#age-18").checked === true,
      },
    });
    state.error = result.ok ? "" : message(result.data);
    state.issuedPassword = result.ok
      ? { login: result.data.account.login_name, password: result.data.temporary_password }
      : null;
    if (result.ok) await loadHome();
    else render();
  });
  const learners = state.accounts.filter((a) => a.role === "learner" && a.status === "active");
  const reset = h("form", { id: "learner-password-reset" }, [
    h(
      "label",
      { for: "reset-account" },
      text(
        "Repor palavra-passe de formando",
        "Reset a learner password",
        "Réinitialiser le mot de passe d’un apprenant"
      )
    ),
    h(
      "select",
      { id: "reset-account" },
      learners.map((a) => h("option", { value: a.id }, `${a.display_name} (${a.login_name})`))
    ),
    ...field(
      "reset-reason",
      text("Motivo (fica registado)", "Reason (recorded)", "Motif (enregistré)"),
      "text",
      {
        minlength: 5,
        maxlength: 300,
      }
    ),
    h("div", { class: "row" }, [
      h(
        "button",
        { type: "submit", class: "secondary" },
        text(
          "Gerar palavra-passe temporária",
          "Issue temporary password",
          "Générer un mot de passe temporaire"
        )
      ),
    ]),
  ]);
  reset.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = reset.querySelector("#reset-account").value;
    const target = learners.find((a) => a.id === id);
    const result = await api(`/api/admin/accounts/${encodeURIComponent(id)}/password-reset`, {
      method: "POST",
      body: { reason: reset.querySelector("#reset-reason").value.trim() },
    });
    state.error = result.ok ? "" : message(result.data);
    state.issuedPassword =
      result.ok && target
        ? { login: target.login_name, password: result.data.temporary_password }
        : null;
    render();
  });
  return h("div", { id: "learner-provisioning" }, [
    renderIssuedPassword(),
    create,
    learners.length ? reset : null,
  ]);
}

const ISSUE_STATUS = {
  draft: { pt: "Rascunho", en: "Draft", fr: "Brouillon" },
  scheduled: { pt: "Agendada", en: "Scheduled", fr: "Programmé" },
  published: { pt: "Publicada", en: "Published", fr: "Publié" },
  unpublished: { pt: "Retirada", en: "Unpublished", fr: "Retiré" },
  archived: { pt: "Arquivada", en: "Archived", fr: "Archivé" },
};
const ISSUE_LANGS = [
  ["pt", { pt: "Português", en: "Portuguese", fr: "Portugais" }],
  ["en", { pt: "Inglês", en: "English", fr: "Anglais" }],
  ["fr", { pt: "Francês", en: "French", fr: "Français" }],
];
// Action -> [route segment, permission, statuses where it applies, label].
const ISSUE_ACTIONS = [
  [
    "publish",
    "publish",
    ["draft", "scheduled", "unpublished"],
    { pt: "Publicar", en: "Publish", fr: "Publier" },
  ],
  [
    "cancel-schedule",
    "cancel_schedule",
    ["scheduled"],
    { pt: "Cancelar agendamento", en: "Cancel schedule", fr: "Annuler la programmation" },
  ],
  ["unpublish", "unpublish", ["published"], { pt: "Retirar", en: "Unpublish", fr: "Retirer" }],
  [
    "revert-to-draft",
    "revert_to_draft",
    ["unpublished"],
    { pt: "Voltar a rascunho", en: "Back to draft", fr: "Repasser en brouillon" },
  ],
  [
    "archive",
    "archive",
    ["draft", "unpublished"],
    { pt: "Arquivar", en: "Archive", fr: "Archiver" },
  ],
];

const canDo = (permission) =>
  Boolean(state.newsletter && state.newsletter.permissions.includes(permission));

async function loadNewsletter(selectId) {
  const list = await api("/api/admin/newsletter/issues");
  if (!list.ok) {
    state.newsletter = null;
    return;
  }
  const previous = state.newsletter || {};
  state.newsletter = {
    issues: list.data.issues || [],
    permissions: list.data.permissions || [],
    selected: null,
    preview: null,
    versions: [],
    audit: [],
    editing: false,
  };
  const id = selectId || (previous.selected && previous.selected.issue.id);
  if (id) await selectIssue(id, false);
}

async function selectIssue(id, rerender = true) {
  const [detail, versions, audit] = await Promise.all([
    api(`/api/admin/newsletter/issues/${id}`),
    api(`/api/admin/newsletter/issues/${id}/versions`),
    canDo("audit") ? api(`/api/admin/newsletter/issues/${id}/audit`) : Promise.resolve(null),
  ]);
  if (!detail.ok) {
    state.error = message(detail.data);
  } else {
    state.newsletter.selected = detail.data;
    state.newsletter.versions = versions.ok ? versions.data.versions : [];
    state.newsletter.audit = audit && audit.ok ? audit.data.entries : [];
    state.newsletter.preview = null;
    state.newsletter.editing = false;
    state.error = "";
  }
  if (rerender) render();
}

function issueFields(prefix, content) {
  const nodes = [];
  ISSUE_LANGS.forEach(([code, label]) => {
    const value = (content && content[code]) || { title: "", summary: "", body: "" };
    const required = code === "pt";
    nodes.push(
      h("fieldset", { class: "issue-lang" }, [
        h("legend", null, pick(label)),
        h("label", { for: `${prefix}-${code}-title` }, text("Título", "Title", "Titre")),
        h("input", {
          id: `${prefix}-${code}-title`,
          type: "text",
          maxlength: 160,
          required,
          value: value.title,
        }),
        h("label", { for: `${prefix}-${code}-summary` }, text("Resumo", "Summary", "Résumé")),
        h("input", {
          id: `${prefix}-${code}-summary`,
          type: "text",
          maxlength: 300,
          required,
          value: value.summary,
        }),
        h("label", { for: `${prefix}-${code}-body` }, text("Texto", "Body", "Texte")),
        h(
          "textarea",
          { id: `${prefix}-${code}-body`, rows: 6, maxlength: 20000, required },
          value.body
        ),
      ])
    );
  });
  nodes.push(
    h(
      "p",
      { class: "muted" },
      text(
        "Formatação: linha em branco separa parágrafos, ## subtítulo, - lista, **negrito**, [texto](https://…). Todo o resto é texto.",
        "Formatting: blank line between paragraphs, ## subheading, - list, **bold**, [text](https://…). Everything else is text.",
        "Mise en forme : ligne vide entre les paragraphes, ## sous-titre, - liste, **gras**, [texte](https://…). Tout le reste est du texte."
      )
    )
  );
  return nodes;
}

function readIssueFields(form, prefix) {
  const content = {};
  ISSUE_LANGS.forEach(([code]) => {
    const title = form.querySelector(`#${prefix}-${code}-title`).value.trim();
    const summary = form.querySelector(`#${prefix}-${code}-summary`).value.trim();
    const body = form.querySelector(`#${prefix}-${code}-body`).value.trim();
    if (code === "pt" || title || summary || body) content[code] = { title, summary, body };
  });
  return content;
}

async function issueAction(path, body) {
  const result = await api(path, { method: "POST", body: body || {} });
  state.error = result.ok ? "" : message(result.data);
  await loadNewsletter(state.newsletter.selected && state.newsletter.selected.issue.id);
  render();
}

function renderIssueDetail() {
  const nl = state.newsletter;
  const selected = nl.selected;
  if (!selected) return null;
  const issue = selected.issue;
  const base = `/api/admin/newsletter/issues/${issue.id}`;
  const actions = ISSUE_ACTIONS.filter(
    ([, permission, statuses]) => canDo(permission) && statuses.includes(issue.status)
  ).map(([segment, , , label]) =>
    h(
      "button",
      {
        type: "button",
        class: segment === "publish" ? null : "secondary",
        onclick: () => issueAction(`${base}/${segment}`),
      },
      pick(label)
    )
  );
  const controls = [
    h(
      "button",
      {
        type: "button",
        class: "secondary",
        onclick: async () => {
          const result = await api(`${base}/preview`);
          state.newsletter.preview = result.ok ? result.data.rendered : null;
          state.error = result.ok ? "" : message(result.data);
          render();
        },
      },
      text("Pré-visualizar", "Preview", "Aperçu")
    ),
  ];
  if (issue.status === "draft" && canDo("edit")) {
    controls.push(
      h(
        "button",
        {
          type: "button",
          class: "secondary",
          onclick: () => {
            state.newsletter.editing = !state.newsletter.editing;
            render();
          },
        },
        text("Editar", "Edit", "Modifier")
      )
    );
  }
  let scheduleForm = null;
  if (issue.status === "draft" && canDo("schedule")) {
    scheduleForm = h("form", { id: "issue-schedule", class: "row" }, [
      h("label", { for: "issue-publish-at" }, text("Publicar em", "Publish at", "Publier le")),
      h("input", { id: "issue-publish-at", type: "datetime-local", required: true }),
      h(
        "button",
        { type: "submit", class: "secondary" },
        text("Agendar", "Schedule", "Programmer")
      ),
    ]);
    scheduleForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const local = scheduleForm.querySelector("#issue-publish-at").value;
      const when = new Date(local);
      if (Number.isNaN(when.getTime())) return;
      issueAction(`${base}/schedule`, { publish_at: when.toISOString() });
    });
  }
  let editor = null;
  if (nl.editing) {
    editor = h("form", { id: "issue-edit" }, [
      ...issueFields("edit", selected.content),
      h("div", { class: "row" }, [
        h(
          "button",
          { type: "submit" },
          text("Guardar nova versão", "Save new version", "Enregistrer une nouvelle version")
        ),
      ]),
    ]);
    editor.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await api(base, {
        method: "PUT",
        body: { expected_version: issue.current_version, content: readIssueFields(editor, "edit") },
      });
      state.error = result.ok ? "" : message(result.data);
      if (result.ok) await selectIssue(issue.id);
      else render();
    });
  }
  // Preview HTML is produced by the server's sanitizer (newsletter/render.js),
  // which escapes all author input and emits only p, h3, ul, li, strong, br
  // and https/mailto links.
  const preview = nl.preview
    ? h(
        "div",
        { class: "issue-preview", id: "issue-preview" },
        ISSUE_LANGS.filter(([code]) => nl.preview[code]).map(([code, label]) => {
          const box = h("article", { class: "issue-preview-lang", lang: code }, [
            h("p", { class: "pill" }, pick(label)),
            h("h3", null, nl.preview[code].title),
            h("p", { class: "muted" }, nl.preview[code].summary),
          ]);
          const body = h("div", { class: "issue-body" });
          body.innerHTML = nl.preview[code].html;
          box.append(body);
          return box;
        })
      )
    : null;
  return h("section", { class: "issue-detail", id: "issue-detail" }, [
    h(
      "h3",
      { lang: LOCALE_TAG[selected.content[lang] ? lang : "pt"] },
      (selected.content[lang] || selected.content.pt).title
    ),
    h("p", { class: "muted" }, [
      h("span", { class: `pill status-${issue.status}` }, labelOf(ISSUE_STATUS, issue.status)),
      ` ${text("Versão", "Version", "Version")} ${issue.current_version}`,
      issue.number ? ` · N.º ${issue.number}` : "",
      issue.scheduled_for
        ? ` · ${text("Agendada para", "Scheduled for", "Programmé pour le")} ${new Date(issue.scheduled_for).toLocaleString(localeTag)}`
        : "",
    ]),
    h("div", { class: "row" }, [...controls, ...actions]),
    scheduleForm,
    editor,
    preview,
    nl.versions.length
      ? h("details", null, [
          h(
            "summary",
            null,
            text("Histórico de versões", "Version history", "Historique des versions")
          ),
          h(
            "ol",
            { reversed: true },
            nl.versions.map((v) =>
              h(
                "li",
                null,
                `${text("Versão", "Version", "Version")} ${v.version} · ${new Date(v.created_at).toLocaleString(localeTag)} · ${v.languages.join("/").toUpperCase()}`
              )
            )
          ),
        ])
      : null,
    nl.audit.length
      ? h("details", null, [
          h("summary", null, text("Registo de auditoria", "Audit log", "Journal d’audit")),
          h(
            "ol",
            null,
            nl.audit.map((e) =>
              h(
                "li",
                null,
                `${new Date(e.at).toLocaleString(localeTag)} · ${e.action} · ${e.from_status || "—"} → ${e.to_status} · v${e.version}`
              )
            )
          ),
        ])
      : null,
  ]);
}

function renderNewsletter() {
  const nl = state.newsletter;
  if (!nl) return null;
  let createForm = null;
  if (canDo("create")) {
    createForm = h("details", { id: "issue-create" }, [
      h("summary", null, text("Nova edição", "New issue", "Nouveau numéro")),
      h("form", { id: "issue-create-form" }, [
        ...field(
          "issue-slug",
          text(
            "Identificador (ex.: dezembro-2026)",
            "Identifier (e.g. december-2026)",
            "Identifiant (par ex. decembre-2026)"
          ),
          "text",
          {
            autocapitalize: "none",
            maxlength: 80,
          }
        ),
        ...issueFields("new", null),
        h("div", { class: "row" }, [
          h(
            "button",
            { type: "submit" },
            text("Criar rascunho", "Create draft", "Créer un brouillon")
          ),
        ]),
      ]),
    ]);
    const form = createForm.querySelector("form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await api("/api/admin/newsletter/issues", {
        method: "POST",
        body: {
          slug: form.querySelector("#issue-slug").value.trim(),
          content: readIssueFields(form, "new"),
        },
      });
      state.error = result.ok ? "" : message(result.data);
      if (result.ok) await loadNewsletter(result.data.issue.id);
      render();
    });
  }
  return h("section", { class: "panel", id: "newsletter-admin" }, [
    h("h2", null, text("Boletim informativo", "Newsletter", "Lettre d’information")),
    nl.issues.length
      ? h(
          "div",
          { class: "row", id: "issue-list" },
          nl.issues.map((issue) =>
            h(
              "button",
              {
                type: "button",
                class: nl.selected && nl.selected.issue.id === issue.id ? null : "secondary",
                onclick: () => selectIssue(issue.id),
              },
              `${issue.slug} · ${labelOf(ISSUE_STATUS, issue.status)}`
            )
          )
        )
      : h(
          "p",
          { class: "muted" },
          text("Ainda não há edições.", "No issues yet.", "Aucun numéro pour l’instant.")
        ),
    renderIssueDetail(),
    createForm,
  ]);
}

const SUB_STATUS = {
  pending: { pt: "Por confirmar", en: "Pending", fr: "En attente" },
  active: { pt: "Ativa", en: "Active", fr: "Actif" },
  unsubscribed: { pt: "Cancelada", en: "Unsubscribed", fr: "Désabonné" },
};

async function loadSubscribers(filters) {
  const f = filters || (state.subscribers && state.subscribers.filters) || {};
  const params = new URLSearchParams();
  Object.entries(f).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const [list, stats, events] = await Promise.all([
    api(`/api/admin/newsletter/subscribers?${params.toString()}`),
    api("/api/admin/newsletter/subscribers/stats"),
    api("/api/admin/newsletter/subscribers/events"),
  ]);
  if (!list.ok) {
    state.subscribers = null;
    return;
  }
  state.subscribers = {
    filters: f,
    rows: list.data.subscribers || [],
    total: list.data.total || 0,
    counts: stats.ok ? stats.data.counts : null,
    events: events.ok ? events.data.events : [],
  };
}

async function subscriberAction(path, body) {
  const result = await api(path, { method: "POST", body });
  state.error = result.ok ? "" : message(result.data);
  await loadSubscribers();
  render();
  return result;
}

function reasonField(id) {
  return [
    h(
      "label",
      { for: id },
      text("Motivo (fica registado)", "Reason (recorded)", "Motif (enregistré)")
    ),
    h("input", { id, type: "text", minlength: 5, maxlength: 300, required: true }),
  ];
}

function renderSubscribers() {
  const subs = state.subscribers;
  if (!subs || !state.account || state.account.role !== "admin") return null;
  const counts = subs.counts;
  const filter = h("form", { id: "subscriber-filter", class: "row" }, [
    h(
      "label",
      { for: "sub-q" },
      text(
        "Procurar (endereço exato ou @domínio)",
        "Search (exact address or @domain)",
        "Rechercher (adresse exacte ou @domaine)"
      )
    ),
    h("input", { id: "sub-q", type: "search", maxlength: 254, value: subs.filters.q || "" }),
    h("label", { for: "sub-status" }, text("Estado", "Status", "Statut")),
    h(
      "select",
      { id: "sub-status" },
      [h("option", { value: "" }, text("Todos", "All", "Tous"))].concat(
        Object.keys(SUB_STATUS).map((key) =>
          h(
            "option",
            { value: key, selected: subs.filters.status === key },
            labelOf(SUB_STATUS, key)
          )
        )
      )
    ),
    h("label", { for: "sub-locale" }, text("Língua", "Language", "Langue")),
    h(
      "select",
      { id: "sub-locale" },
      [h("option", { value: "" }, text("Todas", "All", "Tous"))].concat(
        ISSUE_LANGS.map(([code, label]) =>
          h("option", { value: code, selected: subs.filters.locale === code }, pick(label))
        )
      )
    ),
    h("button", { type: "submit", class: "secondary" }, text("Filtrar", "Filter", "Filtrer")),
  ]);
  filter.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadSubscribers({
      q: filter.querySelector("#sub-q").value.trim(),
      status: filter.querySelector("#sub-status").value,
      locale: filter.querySelector("#sub-locale").value,
    });
    render();
  });

  const rows = subs.rows.map((row) => {
    const form = h("form", { class: "row subscriber-actions" }, [
      ...reasonField(`reason-${row.id}`),
      row.status !== "unsubscribed"
        ? h(
            "button",
            { type: "submit", class: "secondary", value: "unsubscribe" },
            text("Cancelar subscrição", "Unsubscribe", "Désabonner")
          )
        : null,
      h(
        "button",
        { type: "submit", class: "secondary danger", value: "erase" },
        text("Eliminar dados", "Erase data", "Effacer les données")
      ),
    ]);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const action = event.submitter && event.submitter.value === "erase" ? "erase" : "unsubscribe";
      subscriberAction(`/api/admin/newsletter/subscribers/${row.id}/${action}`, {
        reason: form.querySelector(`#reason-${row.id}`).value.trim(),
      });
    });
    return h("li", { class: "subscriber" }, [
      h("p", null, [
        h("strong", null, row.email_masked),
        " ",
        h("span", { class: `pill status-${row.status}` }, labelOf(SUB_STATUS, row.status)),
        ` ${row.locale.toUpperCase()} · ${text("consentimento", "consent", "consentement")} ${row.consent_version}`,
      ]),
      h("details", null, [h("summary", null, text("Ações", "Actions", "Actions")), form]),
    ]);
  });

  const exportForm = h("form", { id: "subscriber-export" }, [
    h(
      "p",
      { class: "muted" },
      text(
        "Exporta apenas subscrições ativas. Cada exportação fica registada com o motivo.",
        "Exports active subscriptions only. Every export is recorded with its reason.",
        "Exporte uniquement les abonnements actifs. Chaque export est enregistré avec son motif."
      )
    ),
    ...reasonField("export-reason"),
    h("div", { class: "row" }, [
      h(
        "button",
        { type: "submit", class: "secondary" },
        text("Exportar CSV", "Export CSV", "Exporter en CSV")
      ),
    ]),
  ]);
  exportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api("/api/admin/newsletter/subscribers/export", {
      method: "POST",
      body: {
        reason: exportForm.querySelector("#export-reason").value.trim(),
        locale: subs.filters.locale || undefined,
      },
    });
    if (!result.ok) {
      state.error = message(result.data);
      render();
      return;
    }
    const url = URL.createObjectURL(
      new Blob([result.data.csv], { type: "text/csv;charset=utf-8" })
    );
    const link = h("a", { href: url, download: "subscritores-ativos.csv" });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    await loadSubscribers();
    render();
  });

  const suppressForm = h("form", { id: "subscriber-suppress" }, [
    h(
      "label",
      { for: "suppress-email" },
      text("Endereço a bloquear", "Address to block", "Adresse à bloquer")
    ),
    h("input", {
      id: "suppress-email",
      type: "email",
      maxlength: 254,
      required: true,
      autocomplete: "off",
    }),
    h("label", { for: "suppress-reason" }, text("Motivo", "Reason", "Motif")),
    h("select", { id: "suppress-reason" }, [
      h("option", { value: "bounce" }, text("Endereço inválido", "Bounced", "Adresse invalide")),
      h("option", { value: "complaint" }, text("Queixa", "Complaint", "Plainte")),
      h(
        "option",
        { value: "admin" },
        text("Decisão administrativa", "Administrative decision", "Décision administrative")
      ),
    ]),
    h("div", { class: "row" }, [
      h(
        "button",
        { type: "submit", class: "secondary" },
        text("Bloquear envios", "Block sending", "Bloquer les envois")
      ),
    ]),
  ]);
  suppressForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await subscriberAction("/api/admin/newsletter/subscribers/suppressions", {
      email: suppressForm.querySelector("#suppress-email").value.trim(),
      reason: suppressForm.querySelector("#suppress-reason").value,
    });
    if (result.ok) suppressForm.reset();
  });

  return h("section", { class: "panel", id: "subscriber-admin" }, [
    h(
      "h2",
      null,
      text("Subscritores do boletim", "Newsletter subscribers", "Abonnés à la lettre d’information")
    ),
    counts
      ? h("div", { class: "metrics" }, [
          h("div", { class: "metric" }, [
            text("Ativas", "Active", "Actifs"),
            h("strong", null, String(counts.active)),
          ]),
          h("div", { class: "metric" }, [
            text("Por confirmar", "Pending", "En attente"),
            h("strong", null, String(counts.pending)),
          ]),
          h("div", { class: "metric" }, [
            text("Bloqueados", "Blocked", "Bloqués"),
            h("strong", null, String(counts.suppressed)),
          ]),
        ])
      : null,
    filter,
    subs.rows.length
      ? h("ul", { class: "subscriber-list" }, rows)
      : h(
          "p",
          { class: "muted" },
          text("Nenhum subscritor encontrado.", "No subscriber found.", "Aucun abonné trouvé.")
        ),
    h("p", { class: "muted" }, `${subs.total} ${text("no total", "in total", "au total")}`),
    h("details", null, [h("summary", null, text("Exportar", "Export", "Exporter")), exportForm]),
    h("details", null, [
      h("summary", null, text("Bloquear um endereço", "Block an address", "Bloquer une adresse")),
      suppressForm,
    ]),
    h("details", null, [
      h(
        "summary",
        null,
        text("Retenção e registo", "Retention and log", "Conservation et journal")
      ),
      h(
        "p",
        { class: "muted" },
        text(
          "Pedidos por confirmar são apagados após 7 dias e subscrições canceladas após 30. Os bloqueios mantêm-se.",
          "Pending requests are deleted after 7 days and cancelled subscriptions after 30. Blocks are kept.",
          "Les demandes en attente sont supprimées après 7 jours et les abonnements résiliés après 30. Les blocages sont conservés."
        )
      ),
      h(
        "button",
        {
          type: "button",
          class: "secondary",
          onclick: () => subscriberAction("/api/admin/newsletter/subscribers/retention", {}),
        },
        text(
          "Aplicar retenção agora",
          "Apply retention now",
          "Appliquer la conservation maintenant"
        )
      ),
      h(
        "ol",
        null,
        subs.events
          .slice(0, 30)
          .map((e) =>
            h(
              "li",
              null,
              `${new Date(e.at).toLocaleString(localeTag)} · ${e.event}${e.detail && e.detail.count != null ? ` · ${e.detail.count}` : ""}`
            )
          )
      ),
    ]),
  ]);
}

// An administrator-issued temporary password must be replaced before the
// session reaches anything else (the server enforces the same boundary).
function renderPasswordChangeOnly() {
  const form = h("form", { id: "forced-password-change" }, [
    ...field(
      "temporary-password",
      text("Palavra-passe temporária", "Temporary password", "Mot de passe temporaire"),
      "password",
      { autocomplete: "current-password" }
    ),
    ...field(
      "forced-new-password",
      text(
        "Nova palavra-passe (12+ caracteres)",
        "New password (12+ characters)",
        "Nouveau mot de passe (12 caractères ou plus)"
      ),
      "password",
      { autocomplete: "new-password", minlength: 12 }
    ),
    h("div", { class: "row" }, [
      h(
        "button",
        { type: "submit" },
        text(
          "Guardar nova palavra-passe",
          "Save new password",
          "Enregistrer le nouveau mot de passe"
        )
      ),
    ]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api("/api/auth/password", {
      method: "POST",
      body: {
        current_password: form.querySelector("#temporary-password").value,
        new_password: form.querySelector("#forced-new-password").value,
      },
    });
    if (!result.ok) {
      state.error = message(result.data);
      render();
      return;
    }
    state.account = null;
    state.passwordChangeRequired = false;
    state.error = "";
    state.linkResult = text(
      "Palavra-passe alterada. Inicie sessão de novo.",
      "Password changed. Sign in again.",
      "Mot de passe modifié. Reconnectez-vous."
    );
    render();
  });
  return authCard(
    "password-change-card",
    text("Nova palavra-passe", "New password", "Nouveau mot de passe"),
    [
      h(
        "p",
        { class: "muted", id: "password-change-required" },
        text(
          "Recebeu uma palavra-passe temporária. Defina a sua própria palavra-passe para continuar.",
          "You received a temporary password. Set your own password to continue.",
          "Vous avez reçu un mot de passe temporaire. Définissez votre propre mot de passe pour continuer."
        )
      ),
      form,
    ]
  );
}

function renderEnrollmentOnly() {
  return h("section", null, [
    h("div", { class: "row" }, [
      h("p", null, `${state.account.display_name} · ${labelOf(ROLE, state.account.role)}`),
      h(
        "button",
        {
          type: "button",
          class: "secondary",
          onclick: async () => {
            await api("/api/auth/logout", { method: "POST" });
            state.account = null;
            state.mfaEnrollmentRequired = false;
            render();
          },
        },
        text("Sair", "Log out", "Se déconnecter")
      ),
    ]),
    renderError(),
    renderSecurity(),
  ]);
}

// Account links (verify email, reset password) carry their token in the URL
// fragment, read once and removed from the address bar.
async function handleAccountLink() {
  const match = window.location.hash.match(
    /^#(account-verify|password-reset)=([A-Za-z0-9_-]{20,200})$/
  );
  if (!match) return;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (match[1] === "password-reset") {
    state.resetToken = match[2];
    return;
  }
  const result = await api("/api/auth/verify-email", { method: "POST", body: { token: match[2] } });
  state.linkResult = result.ok
    ? text(
        "Correio eletrónico confirmado. Já pode iniciar sessão.",
        "Email confirmed. You can sign in now.",
        "Adresse e-mail confirmée. Vous pouvez vous connecter."
      )
    : message(result.data);
}

// Confirmation and unsubscribe links carry their token in the URL fragment.
// It is read once, removed from the address bar, and sent in a POST body.
async function handleNewsletterLink() {
  const match = window.location.hash.match(
    /^#newsletter-(confirm|unsubscribe)=([A-Za-z0-9_-]{20,200})$/
  );
  if (!match) return false;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  // Fixed endpoints: nothing from the URL becomes part of the request path.
  const endpoint =
    match[1] === "confirm" ? "/api/newsletter/confirm" : "/api/newsletter/unsubscribe";
  const result = await api(endpoint, {
    method: "POST",
    body: { token: match[2] },
  });
  if (result.ok) {
    state.linkResult =
      match[1] === "confirm"
        ? text(
            "Subscrição confirmada. Obrigado.",
            "Subscription confirmed. Thank you.",
            "Abonnement confirmé. Merci."
          )
        : text(
            "Subscrição cancelada. Não receberá mais edições.",
            "Unsubscribed. You will not receive more issues.",
            "Désabonnement effectué. Vous ne recevrez plus de numéros."
          );
  } else {
    state.linkResult = message(result.data);
  }
  return true;
}

function renderHome() {
  return h("section", null, [
    h("div", { class: "row" }, [
      h("p", null, `${state.account.display_name} · ${labelOf(ROLE, state.account.role)}`),
      h(
        "button",
        {
          id: "logout",
          class: "secondary",
          type: "button",
          onclick: async () => {
            await api("/api/auth/logout", { method: "POST" });
            state.account = null;
            state.cohort = null;
            state.insights = null;
            state.newsletter = null;
            state.subscribers = null;
            state.issuedPassword = null;
            state.compliance = null;
            render();
          },
        },
        text("Sair", "Log out", "Se déconnecter")
      ),
    ]),
    renderError(),
    h("section", { class: "panel", id: "cohort-list" }, [
      h("h2", null, text("Turmas", "Cohorts", "Cohortes")),
      state.cohorts.length
        ? h("div", { class: "row" }, state.cohorts.map(cohortButton))
        : h(
            "p",
            { class: "muted" },
            text("Nenhuma turma visível.", "No visible cohort.", "Aucune cohorte visible.")
          ),
    ]),
    state.cohort
      ? h("section", { class: "panel" }, [
          h("h2", null, state.cohort.cohort.name),
          h(
            "p",
            { class: "muted" },
            state.cohort.cohort.summary || labelOf(TRACK, state.cohort.cohort.track)
          ),
          renderInsights(),
          renderModules(),
          renderAdminTools(),
        ])
      : null,
    renderAdminHome(),
    renderComplianceReferences(),
    renderNewsletter(),
    renderSubscribers(),
    renderSecurity(),
    renderTools(),
  ]);
}

function render() {
  const root = document.querySelector("#app");
  const children = [
    notice(state.status),
    state.linkResult
      ? h(
          "section",
          { class: "card", id: "newsletter-link-result", role: "status" },
          state.linkResult
        )
      : null,
    state.offline
      ? h("section", { class: "card", id: "offline" }, [
          h(
            "p",
            null,
            text(
              "Serviço de aprendizagem indisponível.",
              "Learning service unavailable.",
              "Service d’apprentissage indisponible."
            )
          ),
        ])
      : state.mfaPending
        ? renderMfaVerify()
        : state.account
          ? state.passwordChangeRequired
            ? renderPasswordChangeOnly()
            : state.mfaEnrollmentRequired
              ? renderEnrollmentOnly()
              : renderHome()
          : state.resetToken
            ? renderResetComplete()
            : state.authView === "register"
              ? renderRegister()
              : state.authView === "reset-request"
                ? renderResetRequest()
                : renderLogin(),
  ].filter(Boolean);
  root.replaceChildren(...children);
  document.documentElement.lang = localeTag;
  document.querySelectorAll(".lang a[hreflang]").forEach((link) => {
    if (link.getAttribute("hreflang") === localeTag) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
  syncHeaderBrand();
}

async function openCohort(id) {
  const [detail, insights] = await Promise.all([
    api(`/api/cohorts/${id}`),
    api(`/api/cohorts/${id}/insights`),
  ]);
  if (!detail.ok) {
    state.error = message(detail.data);
    render();
    return;
  }
  state.cohort = detail.data;
  state.insights = insights.ok ? insights.data : null;
  state.error = "";
  render();
}

async function startSession() {
  const session = await api("/api/auth/session");
  if (!session.ok) {
    state.mfaPending = session.data && session.data.error === "mfa_required";
    render();
    return;
  }
  state.account = session.data.account;
  state.mfaEnrollmentRequired = session.data.mfa_enrollment_required === true;
  state.passwordChangeRequired = session.data.password_change_required === true;
  await loadHome();
}

async function loadHome() {
  if (state.passwordChangeRequired) {
    render();
    return;
  }
  if (state.mfaEnrollmentRequired) {
    await loadSecurity();
    render();
    return;
  }
  const [cohorts, tools, catalog] = await Promise.all([
    api("/api/cohorts"),
    api("/api/tools"),
    api("/api/catalog/courses"),
  ]);
  if (!cohorts.ok) {
    state.error = message(cohorts.data);
    render();
    return;
  }
  state.cohorts = cohorts.data.cohorts || [];
  state.tools = tools.ok ? tools.data.adapters || [] : [];
  state.catalog = catalog.ok ? catalog.data.courses || [] : [];
  if (state.account.role === "admin") {
    const [overview, accounts, compliance] = await Promise.all([
      api("/api/admin/overview"),
      api("/api/admin/accounts"),
      api("/api/admin/compliance-references"),
    ]);
    state.overview = overview.ok ? overview.data : null;
    state.accounts = accounts.ok ? accounts.data.accounts || [] : [];
    state.compliance = compliance.ok ? compliance.data : null;
  }
  if (state.account.role === "admin" || state.account.role === "instructor") {
    await loadNewsletter();
  }
  if (state.account.role === "admin") await loadSubscribers();
  await loadSecurity();
  if (!state.cohort && state.cohorts.length === 1) {
    await openCohort(state.cohorts[0].id);
    return;
  }
  render();
}

async function boot() {
  try {
    const status = await api("/api/learning/status");
    if (!status.ok || !status.data || status.data.service !== "biug-academy-learning") {
      state.offline = true;
      render();
      return;
    }
    state.status = status.data;
    await handleNewsletterLink();
    await handleAccountLink();
    await startSession();
  } catch (_error) {
    state.offline = true;
    render();
  }
}

boot();
