// Officer editing for the homepage and the Officers, Competitions and Resources pages.
//
// Visitors: if the club has saved a version of a page, it's loaded from Firestore and shown in place of
// what's written in the HTML (or slides.txt on the Resources page).
// Officers: "Officer Login" in the top bar signs in with the club Google account, and the page becomes
// editable in place. Only that account can save; the Firestore rules in EDITING.md enforce it.
import { firebaseConfig, EDITOR_EMAIL } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
const SIGNED_IN_KEY = "tinoEditor";
const page = document.body.dataset.cms;
const list = document.querySelector("[data-cms-list]");
const configured = Boolean(firebaseConfig && firebaseConfig.projectId && firebaseConfig.apiKey);

let editing = false;
let dirty = false;
let statusLine = null;

/* ---------- Small helpers ---------- */

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function button(label, onClick, className = "cms-btn") {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function textOf(node) {
  return node ? node.textContent.replace(/\s+/g, " ").trim() : "";
}

function safeLink(url) {
  return /^https?:\/\//i.test(url || "") ? url : "";
}

function safeImage(src) {
  return /^(data:image\/|https?:\/\/|assets\/)/i.test(src || "") ? src : "";
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
}

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function readFlag() {
  try {
    return localStorage.getItem(SIGNED_IN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeFlag(on) {
  try {
    if (on) localStorage.setItem(SIGNED_IN_KEY, "1");
    else localStorage.removeItem(SIGNED_IN_KEY);
  } catch {
    // Private browsing: the editor just won't reopen by itself after a reload
  }
}

function setStatus(message) {
  if (statusLine) statusLine.textContent = message;
}

function markDirty() {
  dirty = true;
  setStatus("Unsaved changes");
}

// Turns a piece of text into an editable field (plain text only, Enter doesn't add a new line)
function editable(node, placeholder) {
  try {
    node.contentEditable = "plaintext-only";
  } catch {
    node.contentEditable = "true";
  }
  node.classList.add("cms-editable");
  node.dataset.placeholder = placeholder;
  node.spellcheck = true;
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter") event.preventDefault();
  });
  node.addEventListener("paste", (event) => {
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
  });
  node.addEventListener("input", markDirty);
}

// Puts an image in a photo/logo box, or clears it. The box remembers the source in data-src.
function setImage(holder, src, alt, { onMissing, emptyText } = {}) {
  holder.dataset.src = src;
  [...holder.childNodes].forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE || child.tagName === "IMG") child.remove();
  });
  if (src) {
    const img = el("img");
    img.src = src;
    img.alt = alt;
    if (onMissing) img.addEventListener("error", () => onMissing(img));
    holder.append(img);
  } else if (emptyText) {
    holder.append(emptyText);
  }
}

// Shrinks a picked photo so it loads fast and fits in the saved page (about 30 to 60 KB)
async function shrinkImage(file, maxSize = 480) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = el("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function imageTools(holder, noun, getAlt, options) {
  const input = el("input");
  input.type = "file";
  input.accept = "image/*";
  input.hidden = true;
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    try {
      setStatus("Shrinking the image…");
      setImage(holder, await shrinkImage(file), getAlt(), options);
      markDirty();
    } catch {
      setStatus("That file couldn't be opened as an image. Try a JPG or PNG.");
    }
  });
  const tools = el("div", "cms-tools");
  tools.append(
    button(`Change ${noun}`, () => input.click()),
    button(`Remove ${noun}`, () => {
      setImage(holder, "", getAlt(), options);
      markDirty();
    }),
    input,
  );
  return tools;
}

function itemTools(node, noun) {
  const tools = el("div", "cms-tools");
  tools.append(
    button("↑ Move up", () => {
      if (node.previousElementSibling) {
        node.previousElementSibling.before(node);
        markDirty();
      }
    }),
    button("↓ Move down", () => {
      if (node.nextElementSibling) {
        node.nextElementSibling.after(node);
        markDirty();
      }
    }),
    button(`Remove ${noun}`, () => {
      if (confirm(`Remove this ${noun}? It disappears from the site once you save.`)) {
        node.remove();
        markDirty();
      }
    }),
  );
  return tools;
}

/* ---------- The three kinds of lists ---------- */

const officers = {
  item: "article.officer",
  addLabel: "+ Add an officer",
  blank: () => ({ name: "", role: "", bio: "", photo: "" }),
  parse(node) {
    return {
      name: textOf(node.querySelector(".person-name")),
      role: textOf(node.querySelector(".person-role")),
      bio: textOf(node.querySelector(".person-bio")),
      photo: node.querySelector(".headshot").dataset.src || "",
    };
  },
  render(officer) {
    const node = el("article", "officer");
    const shot = el("div", "headshot");
    const letters = el("span", "initials", initials(officer.name));
    letters.setAttribute("aria-hidden", "true");
    shot.append(letters);
    const imageOptions = { onMissing: (img) => img.remove() };
    setImage(shot, safeImage(officer.photo), officer.name, imageOptions);

    const body = el("div");
    const name = el("h2", "person-name", officer.name);
    const role = el("p", "person-role", officer.role);
    const bio = el("p", "person-bio", officer.bio);
    body.append(name, role, bio);
    node.append(shot, body);

    if (editing) {
      editable(name, "Name");
      editable(role, "Role, like Treasurer");
      editable(bio, "Short bio (optional)");
      name.addEventListener("input", () => {
        letters.textContent = initials(name.textContent);
      });
      body.append(imageTools(shot, "photo", () => textOf(name), imageOptions), itemTools(node, "officer"));
    }
    return node;
  },
};

function dateRow(row) {
  const li = el("li");
  const label = el("b", "date-label", row.label);
  const value = el("span", "date-value", row.value);
  li.append(label, " ", value);
  if (editing) {
    editable(label, "Label");
    editable(value, "Date or detail");
    const remove = button("×", () => {
      li.remove();
      markDirty();
    }, "cms-btn cms-x");
    remove.setAttribute("aria-label", "Remove this line");
    li.append(" ", remove);
  }
  return li;
}

const competitions = {
  item: "article.comp",
  addLabel: "+ Add a competition",
  blank: () => ({ logo: "", name: "", desc: "", dates: [{ label: "Register by", value: "" }], url: "", linkText: "" }),
  parse(node) {
    const urlInput = node.querySelector(".comp-url");
    const link = node.querySelector(".comp-link");
    return {
      logo: node.querySelector(".comp-logo").dataset.src || "",
      name: textOf(node.querySelector(".comp-name")),
      desc: textOf(node.querySelector(".comp-desc")),
      dates: [...node.querySelectorAll(".comp-dates li:not(.comp-site)")]
        .map((li) => ({ label: textOf(li.querySelector(".date-label")), value: textOf(li.querySelector(".date-value")) }))
        .filter((row) => row.label || row.value),
      url: urlInput ? urlInput.value.trim() : (link && link.getAttribute("href")) || "",
      linkText: textOf(link),
    };
  },
  render(comp) {
    const node = el("article", "comp");
    const logo = el("div", "comp-logo");
    const logoOptions = { onMissing: (img) => img.replaceWith(img.alt), emptyText: comp.name };
    setImage(logo, safeImage(comp.logo), comp.name, logoOptions);

    const body = el("div");
    const name = el("h2", "comp-name", comp.name);
    const desc = el("p", "comp-desc", comp.desc);
    const rows = el("ul", "raquo comp-dates");
    comp.dates.forEach((row) => rows.append(dateRow(row)));

    const site = el("li", "comp-site");
    site.append(el("b", "date-label", "Website"), " ");
    if (editing) {
      const text = el("span", "comp-link", comp.linkText);
      editable(text, "Link text, like yis.org");
      const url = el("input", "cms-input cms-url comp-url");
      url.type = "url";
      url.value = comp.url;
      url.placeholder = "https://…";
      url.setAttribute("aria-label", "Website link");
      url.addEventListener("input", markDirty);
      site.append(text, " ", url);
    } else {
      const link = el("a", "comp-link", comp.linkText || comp.url);
      link.href = safeLink(comp.url) || "#";
      link.target = "_blank";
      link.rel = "noopener";
      site.append(link);
      site.hidden = !safeLink(comp.url);
    }
    rows.append(site);
    body.append(name, desc, rows);
    node.append(logo, body);

    if (editing) {
      editable(name, "Competition name");
      editable(desc, "One or two sentences about it");
      body.append(
        button("+ Add a date line", () => {
          const row = dateRow({ label: "", value: "" });
          site.before(row);
          row.querySelector(".date-label").focus();
          markDirty();
        }, "cms-btn cms-add-line"),
        imageTools(logo, "logo", () => textOf(name), logoOptions),
        itemTools(node, "competition"),
      );
    }
    return node;
  },
};

const resources = {
  item: "li",
  addLabel: "+ Add meeting slides",
  addAtTop: true,
  blank: () => ({ date: today(), title: "", url: "" }),
  parse(node) {
    const dateInput = node.querySelector(".slide-date-input");
    const urlInput = node.querySelector(".slide-url");
    const link = node.querySelector("a.slide-title");
    return {
      date: dateInput ? dateInput.value : node.querySelector(".slide-date")?.dataset.date || "",
      title: textOf(node.querySelector(".slide-title")) || "Meeting slides",
      url: urlInput ? urlInput.value.trim() : (link && link.getAttribute("href")) || "",
    };
  },
  render(slide) {
    const li = el("li");
    if (editing) {
      li.className = "cms-slide";
      const date = el("input", "cms-input slide-date-input");
      date.type = "date";
      date.value = slide.date;
      date.setAttribute("aria-label", "Meeting date");
      const title = el("span", "slide-title", slide.title === "Meeting slides" ? "" : slide.title);
      editable(title, "Title, like Intro to the stock market");
      const url = el("input", "cms-input cms-url slide-url");
      url.type = "url";
      url.value = slide.url;
      url.placeholder = "Paste the slides link";
      url.setAttribute("aria-label", "Slides link");
      [date, url].forEach((input) => input.addEventListener("input", markDirty));
      li.append(date, title, url, button("Remove", () => {
        if (confirm("Remove these slides? They disappear from the site once you save.")) {
          li.remove();
          markDirty();
        }
      }));
      return li;
    }
    if (slide.date) {
      const date = el("b", "slide-date", formatDate(slide.date));
      date.dataset.date = slide.date;
      li.append(date, ": ");
    }
    const link = el("a", "slide-title", slide.title || "Meeting slides");
    link.href = safeLink(slide.url) || "#";
    link.target = "_blank";
    link.rel = "noopener";
    li.append(link);
    return li;
  },
  prepare(items) {
    // Newest first; slides with no date go last. Rows without a link never show.
    return items.filter((slide) => safeLink(slide.url)).sort((a, b) => b.date.localeCompare(a.date));
  },
};

const type = { officers, competitions, resources }[page];

/* ---------- Showing the list ---------- */

function collectItems() {
  return [...list.querySelectorAll(`:scope > ${type.item}`)].map((node) => type.parse(node));
}

export function renderList(items) {
  const shown = type.prepare && !editing ? type.prepare(items) : items;
  list.replaceChildren(...shown.map((item) => type.render(item)));
}

// A saved page looks like { items: [...] } for the list pages and { fields: {...}, images: {...} } for the homepage
async function fetchSaved(name = page) {
  const { projectId, apiKey } = firebaseConfig;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/site/${name}?key=${apiKey}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null; // 404 means nothing has been saved for this page yet
  const saved = await response.json();
  return JSON.parse(saved.fields.json.stringValue);
}

// slides.txt: one meeting per line, "date | title | link" (see the notes at the top of that file)
async function loadSlidesFile() {
  try {
    const response = await fetch("slides.txt", { cache: "no-cache" });
    if (!response.ok) return [];
    return (await response.text())
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const parts = line.split("|").map((part) => part.trim()).filter(Boolean);
        const url = parts.find((part) => /^https?:\/\//i.test(part)) || "";
        const date = parts.find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part)) || "";
        const title = parts.find((part) => part !== url && part !== date) || "Meeting slides";
        return { date, title, url };
      });
  } catch {
    return [];
  }
}

/* ---------- Free-form text and pictures (homepage) ---------- */
// In the HTML: data-cms-field="name" marks editable text (add data-cms-mode="rich" to allow bold, links,
// lists and pictures), and data-cms-image="name" marks a picture that can be swapped.

const RICH_TAGS = {
  P: [], BR: [], B: [], STRONG: [], I: [], EM: [], U: [], H3: [], UL: [], OL: [], LI: [], DIV: [], SPAN: [],
  A: ["href"],
  IMG: ["src", "alt"],
};
const DROP_TAGS = ["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "LINK", "META", "SVG", "MATH", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT"];

let activeField = null;
let savedRange = null;

const fieldNodes = () => [...document.querySelectorAll("[data-cms-field]")];
const imageNodes = () => [...document.querySelectorAll("[data-cms-image]")];

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function safeHref(href) {
  return /^(https?:\/\/|mailto:|#|\.\/|[\w-]+\.html(#[\w-]*)?$)/i.test(href || "") ? href : "";
}

// Keeps only simple formatting, links and pictures, so saved text can never run code on the page
function sanitize(html) {
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html").body.firstChild;
  const clean = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (child.nodeType !== Node.ELEMENT_NODE) return child.remove();
      const tag = child.tagName.toUpperCase();
      if (DROP_TAGS.includes(tag)) return child.remove();
      clean(child);
      const allowed = RICH_TAGS[tag];
      if (!allowed) return child.replaceWith(...child.childNodes);
      [...child.attributes].forEach((attr) => {
        if (!allowed.includes(attr.name)) child.removeAttribute(attr.name);
      });
      if (tag === "A") {
        const href = safeHref(child.getAttribute("href"));
        if (!href) return child.replaceWith(...child.childNodes);
        if (/^https?:/i.test(href)) {
          child.target = "_blank";
          child.rel = "noopener";
        }
      }
      if (tag === "IMG" && !safeImage(child.getAttribute("src"))) child.remove();
      if (tag === "UL") child.className = "raquo";
    });
  };
  clean(root);
  return root.innerHTML;
}

export function applySaved(saved) {
  fieldNodes().forEach((node) => {
    const value = saved.fields?.[node.dataset.cmsField];
    if (typeof value !== "string") return;
    if (node.dataset.cmsMode === "rich") node.innerHTML = sanitize(value);
    else node.textContent = value;
  });
  imageNodes().forEach((img) => {
    const value = saved.images?.[img.dataset.cmsImage];
    if (value === undefined) return;
    const src = safeImage(value);
    if (src) img.src = src;
    else img.removeAttribute("src"); // saved as removed: the spot stays blank
  });
  syncLinks();
}

// A link that follows the first link in a field (the QR code opens whatever its caption links to)
function syncLinks() {
  document.querySelectorAll("[data-cms-link-from]").forEach((link) => {
    const href = document.querySelector(`[data-cms-field="${link.dataset.cmsLinkFrom}"] a[href]`)?.getAttribute("href");
    if (href) link.href = href;
  });
}

function collectFields() {
  return Object.fromEntries(fieldNodes().map((node) => [
    node.dataset.cmsField,
    node.dataset.cmsMode === "rich" ? sanitize(node.innerHTML) : textOf(node),
  ]));
}

function collectImages() {
  return Object.fromEntries(imageNodes().map((img) => [img.dataset.cmsImage, img.getAttribute("src") || ""]));
}

// The homepage officer list follows whatever was saved on the Officers page
function renderTeam(officerItems) {
  const team = document.querySelector("[data-cms-officers]");
  if (!team || !officerItems?.length) return;
  team.replaceChildren(...officerItems.flatMap((officer) => [el("dt", "", officer.role), el("dd", "", officer.name)]));
}

function rememberSelection() {
  const selection = getSelection();
  if (!selection.rangeCount) return;
  const anchor = selection.anchorNode;
  const start = anchor && (anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement);
  const field = start?.closest('[data-cms-mode="rich"]');
  if (field) {
    activeField = field;
    savedRange = selection.getRangeAt(0).cloneRange();
  }
}

function restoreSelection() {
  if (!activeField || !savedRange) return false;
  activeField.focus();
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(savedRange);
  return true;
}

function enableFields() {
  fieldNodes().forEach((node) => {
    if (node.dataset.cmsMode !== "rich") {
      editable(node, "Text");
      return;
    }
    node.contentEditable = "true";
    node.classList.add("cms-editable", "cms-rich");
    node.dataset.placeholder = "Type here";
    node.addEventListener("input", markDirty);
    node.addEventListener("paste", (event) => {
      event.preventDefault();
      const html = event.clipboardData.getData("text/html");
      if (html) document.execCommand("insertHTML", false, sanitize(html));
      else document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
    });
    // Clicking a picture selects it, so Delete or Backspace removes it
    node.addEventListener("click", (event) => {
      if (event.target.tagName !== "IMG") return;
      const range = document.createRange();
      range.selectNode(event.target);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
  });
  document.addEventListener("selectionchange", rememberSelection);
  document.execCommand("defaultParagraphSeparator", false, "p");

  // Links around swappable pictures shouldn't open while editing
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-cms-link-from]")) event.preventDefault();
  }, true);

  imageNodes().forEach((img) => {
    const picker = el("input");
    picker.type = "file";
    picker.accept = "image/*";
    picker.hidden = true;
    picker.addEventListener("change", async () => {
      const file = picker.files[0];
      picker.value = "";
      if (!file) return;
      try {
        setStatus("Shrinking the image…");
        img.src = await shrinkImage(file, Number(img.dataset.cmsMax) || 600);
        markDirty();
      } catch {
        setStatus("That file couldn't be opened as an image. Try a JPG or PNG.");
      }
    });
    const tools = el("div", "cms-tools cms-image-tools");
    tools.append(
      button("Change image", () => picker.click()),
      button("Remove image", () => {
        img.removeAttribute("src");
        markDirty();
      }),
      picker,
    );
    (img.closest("a, .hero-photo") || img).after(tools);
  });
}

function formatToolbar() {
  const bar = el("div", "cms-format");
  bar.append(el("span", "cms-format-label", "Text tools:"));
  const command = (label, run) => {
    const node = button(label, () => {
      if (!activeField) {
        setStatus("Click into a text box first, then use the text tools.");
        return;
      }
      run();
    });
    node.addEventListener("mousedown", (event) => event.preventDefault()); // keeps the cursor in the text
    return node;
  };
  const picker = el("input");
  picker.type = "file";
  picker.accept = "image/*";
  picker.hidden = true;
  picker.addEventListener("change", async () => {
    const file = picker.files[0];
    picker.value = "";
    if (!file) return;
    try {
      setStatus("Shrinking the image…");
      const src = await shrinkImage(file, 900);
      restoreSelection();
      document.execCommand("insertImage", false, src);
      markDirty();
      setStatus("Image added. To remove it, click the image and press Delete.");
    } catch {
      setStatus("That file couldn't be opened as an image. Try a JPG or PNG.");
    }
  });
  bar.append(
    command("Bold", () => {
      document.execCommand("bold");
      markDirty();
    }),
    command("Italic", () => {
      document.execCommand("italic");
      markDirty();
    }),
    command("Link", () => {
      const url = (prompt("Link address (https://… or mailto:someone@gmail.com)") || "").trim();
      if (!url) return;
      if (!safeHref(url)) {
        setStatus("Links need to start with https:// or mailto:");
        return;
      }
      restoreSelection();
      if (getSelection().isCollapsed) document.execCommand("insertHTML", false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
      else document.execCommand("createLink", false, url);
      markDirty();
    }),
    command("Bullet list", () => {
      document.execCommand("insertUnorderedList");
      markDirty();
    }),
    command("Insert image", () => picker.click()),
    command("Clear formatting", () => {
      document.execCommand("removeFormat");
      document.execCommand("unlink");
      markDirty();
    }),
    picker,
  );
  return bar;
}

/* ---------- Signing in and editing ---------- */

let firebasePromise = null;

function loadFirebase() {
  firebasePromise ??= Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ])
    .then(([appLib, authLib, store]) => {
      const app = appLib.initializeApp(firebaseConfig);
      return { auth: authLib.getAuth(app), authLib, db: store.getFirestore(app), store };
    })
    .catch((error) => {
      firebasePromise = null;
      throw error;
    });
  return firebasePromise;
}

function isEditor(user) {
  return Boolean(user && user.emailVerified && user.email && user.email.toLowerCase() === EDITOR_EMAIL.toLowerCase());
}

// Sign-in problems show next to the Officer Login link (alert boxes don't appear in every browser)
let loginNote = null;

function showLoginNote(message) {
  if (!loginNote) {
    loginNote = el("span", "cms-login-note");
    loginNote.setAttribute("role", "alert");
    document.querySelector(".cms-login")?.after(loginNote);
  }
  loginNote.textContent = message;
}

async function login() {
  showLoginNote("Opening Google sign-in…");
  let fb;
  try {
    fb = await loadFirebase();
  } catch {
    showLoginNote("Couldn't load the sign-in tools. Check your internet connection and try again.");
    return;
  }
  const provider = new fb.authLib.GoogleAuthProvider();
  provider.setCustomParameters({ login_hint: EDITOR_EMAIL, prompt: "select_account" });
  try {
    const { user } = await fb.authLib.signInWithPopup(fb.auth, provider);
    if (!isEditor(user)) {
      await fb.authLib.signOut(fb.auth);
      showLoginNote(`${user.email} can't edit this site. Click Officer Login again and choose ${EDITOR_EMAIL}.`);
      return;
    }
    writeFlag(true);
    startEditing(fb, user);
  } catch (error) {
    const messages = {
      "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow pop-ups for this site, then click Officer Login again.",
      "auth/popup-closed-by-user": "The sign-in window was closed before you finished.",
      "auth/cancelled-popup-request": "The sign-in window was closed before you finished.",
      "auth/unauthorized-domain": `This address (${location.hostname}) isn't allowed to sign in yet. Add it in Firebase under Authentication, Settings, Authorized domains.`,
      "auth/operation-not-allowed": "Google sign-in is turned off. Turn it on in Firebase under Authentication, Sign-in method.",
      "auth/network-request-failed": "Couldn't reach Google. Check your internet connection and try again.",
    };
    showLoginNote(messages[error.code] || `Sign-in didn't work (${error.code || error.message}).`);
  }
}

function addLoginLink() {
  const spot = document.querySelector(".utility-in > span");
  if (!spot) return;
  const link = button("Officer Login", login, "link-button cms-login");
  // Start loading the sign-in code early so the Google window isn't blocked as a pop-up
  const warmUp = () => loadFirebase().catch(() => {});
  link.addEventListener("pointerenter", warmUp, { once: true });
  link.addEventListener("focus", warmUp, { once: true });
  const wrap = el("span", "cms-login-wrap");
  wrap.append(" • ", link);
  spot.append(wrap);
}

async function resumeSession() {
  try {
    const fb = await loadFirebase();
    fb.authLib.onAuthStateChanged(fb.auth, (user) => {
      if (isEditor(user)) startEditing(fb, user);
      else writeFlag(false);
    });
  } catch {
    // Offline or blocked: stay in the normal view
  }
}

async function save(fb, user) {
  const payload = {};
  let skipped = 0;
  if (type && list) {
    const items = collectItems();
    payload.items = type.prepare ? type.prepare(items) : items;
    skipped = items.length - payload.items.length;
  }
  if (fieldNodes().length) payload.fields = collectFields();
  if (imageNodes().length) payload.images = collectImages();
  const json = JSON.stringify(payload);
  if (json.length > 900000) {
    setStatus("This page is too big to save. Remove an image or use smaller ones.");
    return;
  }
  syncLinks();
  setStatus("Saving…");
  try {
    await fb.store.setDoc(fb.store.doc(fb.db, "site", page), {
      json,
      updatedAt: fb.store.serverTimestamp(),
      updatedBy: user.email,
    });
    dirty = false;
    setStatus(skipped
      ? `Saved. Skipped ${skipped} row${skipped === 1 ? "" : "s"} with no link.`
      : "Saved. The live site shows this version now.");
  } catch (error) {
    setStatus(`Couldn't save (${error.code || error.message}). Make sure you're signed in as ${EDITOR_EMAIL}.`);
  }
}

export function startEditing(fb, user) {
  if (editing) return;
  const items = type && list ? collectItems() : null;
  editing = true;
  document.body.classList.add("cms-editing");
  document.querySelector(".cms-login-wrap")?.remove();
  loginNote?.remove();

  if (items) {
    renderList(items);
    const add = button(type.addLabel, () => {
      const node = type.render(type.blank());
      if (type.addAtTop) list.prepend(node);
      else list.append(node);
      node.querySelector(".cms-editable")?.focus();
      markDirty();
    }, "cms-add");
    list.after(add);
  }
  if (fieldNodes().length || imageNodes().length) enableFields();

  const bar = el("div", "cms-bar");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Editing tools");
  const who = el("span", "cms-who");
  who.append("Editing as ", el("strong", "", user.email));
  const hint = document.querySelector("[data-cms-officers]")
    ? "Click any outlined text to change it, then save. Officers are edited on the Officers page."
    : "Click any outlined text to change it, then save.";
  statusLine = el("span", "cms-status", hint);
  statusLine.setAttribute("aria-live", "polite");
  bar.append(
    who,
    statusLine,
    button("Save changes", () => save(fb, user), "cms-btn cms-btn-primary"),
    button("Discard changes", () => {
      if (!dirty || confirm("Throw away your unsaved changes?")) {
        dirty = false;
        location.reload();
      }
    }),
    button("Sign out", async () => {
      if (dirty && !confirm("You have unsaved changes. Sign out anyway?")) return;
      dirty = false;
      writeFlag(false);
      await fb.authLib.signOut(fb.auth);
      location.reload();
    }),
  );
  if (fieldNodes().some((node) => node.dataset.cmsMode === "rich")) bar.append(formatToolbar());
  document.body.prepend(bar);

  window.addEventListener("beforeunload", (event) => {
    if (dirty) event.preventDefault();
  });
}

/* ---------- Start ---------- */

async function init() {
  if (!page) return;
  let saved = null;
  let savedOfficers = null;
  if (configured) {
    [saved, savedOfficers] = await Promise.all([
      fetchSaved(page).catch(() => null),
      document.querySelector("[data-cms-officers]") ? fetchSaved("officers").catch(() => null) : null,
    ]);
  }
  if (type && list) {
    let items = saved?.items || null;
    if (!items && page === "resources") items = await loadSlidesFile();
    if (items) renderList(items);
    list.removeAttribute("aria-busy");
  }
  if (saved) applySaved(saved);
  if (savedOfficers) renderTeam(savedOfficers.items);
  document.body.classList.remove("cms-pending");

  if (!configured) return;
  addLoginLink();
  if (readFlag()) resumeSession();
}

init();
