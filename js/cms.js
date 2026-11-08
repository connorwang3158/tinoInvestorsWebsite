// Officer editing for the Officers, Competitions and Resources pages.
//
// Visitors: if the club has saved a version of this page's list, it's loaded from Firestore and shown
// in place of the list written in the HTML (or slides.txt on the Resources page).
// Officers: "Officer Login" in the top bar signs in with the club Google account, and the list becomes
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

async function fetchSaved() {
  const { projectId, apiKey } = firebaseConfig;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/site/${page}?key=${apiKey}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null; // 404 means nothing has been saved for this page yet
  const saved = await response.json();
  return JSON.parse(saved.fields.json.stringValue).items;
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

async function login() {
  let fb;
  try {
    fb = await loadFirebase();
  } catch {
    alert("Couldn't load the sign-in tools. Check your internet connection and try again.");
    return;
  }
  const provider = new fb.authLib.GoogleAuthProvider();
  provider.setCustomParameters({ login_hint: EDITOR_EMAIL, prompt: "select_account" });
  try {
    const { user } = await fb.authLib.signInWithPopup(fb.auth, provider);
    if (!isEditor(user)) {
      await fb.authLib.signOut(fb.auth);
      alert(`${user.email} can't edit this site. Sign in with ${EDITOR_EMAIL}.`);
      return;
    }
    writeFlag(true);
    startEditing(fb, user);
  } catch (error) {
    if (error.code === "auth/popup-blocked") {
      alert("Your browser blocked the sign-in window. Click Officer Login again.");
    } else if (error.code !== "auth/popup-closed-by-user" && error.code !== "auth/cancelled-popup-request") {
      alert(`Sign-in didn't work (${error.code || error.message}).`);
    }
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
  spot.append(" • ", link);
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
  const items = collectItems();
  const kept = type.prepare ? type.prepare(items) : items;
  const skipped = items.length - kept.length;
  const json = JSON.stringify({ items: kept });
  if (json.length > 900000) {
    setStatus("This page is too big to save. Use fewer or smaller images.");
    return;
  }
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
  const items = collectItems();
  editing = true;
  document.body.classList.add("cms-editing");
  document.querySelector(".cms-login")?.remove();
  renderList(items);

  const add = button(type.addLabel, () => {
    const node = type.render(type.blank());
    if (type.addAtTop) list.prepend(node);
    else list.append(node);
    node.querySelector(".cms-editable")?.focus();
    markDirty();
  }, "cms-add");
  list.after(add);

  const bar = el("div", "cms-bar");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Editing tools");
  const who = el("span", "cms-who");
  who.append("Editing as ", el("strong", "", user.email));
  statusLine = el("span", "cms-status", "Click any outlined text to change it, then save.");
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
  document.body.prepend(bar);

  window.addEventListener("beforeunload", (event) => {
    if (dirty) event.preventDefault();
  });
}

/* ---------- Start ---------- */

async function init() {
  if (!type || !list) return;
  let items = null;
  if (configured) {
    try {
      items = await fetchSaved();
    } catch {
      items = null;
    }
  }
  if (!items && page === "resources") items = await loadSlidesFile();
  if (items) renderList(items);
  list.removeAttribute("aria-busy");

  if (!configured) return;
  addLoginLink();
  if (readFlag()) resumeSession();
}

init();
