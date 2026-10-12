
"use strict";

// Configuración pública de Supabase
const SUPABASE_URL = "https://dycelukdozhfjhqfhydn.supabase.co";
const SUPABASE_KEY = "sb_publishable_1Jwz3hhEQ6C7MdpPe9xXTw_aL0hPuQg";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const $ = id => document.getElementById(id);

let currentUser = null;
let memoryKey = null;
let keySalt = null;

function status(id, message) {
  $(id).textContent = message;
}

function showApp(signedIn) {
  $("login").hidden = signedIn;
  $("app").hidden = !signedIn;
}

function addMessage(text, type) {
  const el = document.createElement("div");
  el.className = `bubble ${type}`;
  el.textContent = text;
  $("messages").appendChild(el);
  $("messages").scrollTop = $("messages").scrollHeight;
}

async function setupEncryption(password) {
  const result = await db
    .from("memory_keys")
    .select("key_salt")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (result.error) throw result.error;

  if (result.data) {
    keySalt = result.data.key_salt;
    memoryKey = await MemoryCrypto.unlockKey(password, keySalt);
    return;
  }

  const generated = await MemoryCrypto.createKey(password);
  keySalt = generated.salt;
  memoryKey = generated.key;

  const inserted = await db.from("memory_keys").insert({
    user_id: currentUser.id,
    key_salt: keySalt
  });

  if (inserted.error) {
    memoryKey = null;
    keySalt = null;
    throw inserted.error;
  }
}

async function saveMemory(content) {
  const encrypted = await MemoryCrypto.encrypt(content, memoryKey);

  const { error } = await db.from("memories").insert({
    user_id: currentUser.id,
    encrypted_content: encrypted.encrypted_content,
    iv: encrypted.iv,
    key_salt: keySalt
  });

  if (error) throw error;
}

async function getMemories() {
  const { data, error } = await db
    .from("memories")
    .select("id, encrypted_content, iv, created_at")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const memories = [];

  for (const item of data) {
    try {
      const content = await MemoryCrypto.decrypt(
        item.encrypted_content,
        item.iv,
        memoryKey
      );

      memories.push({ ...item, content });
    } catch {
      throw new Error(
        "No se pudo descifrar un recuerdo. Comprueba tu contraseña."
      );
    }
  }

  return memories;
}

function setView(view) {
  $("chat-view").hidden = view !== "chat";
  $("memories-view").hidden = view !== "memories";

  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.view === view);
  });

  if (view === "memories") renderMemories();
}

async function renderMemories() {
  const list = $("memory-list");
  list.replaceChildren();

  try {
    const memories = await getMemories();

    if (!memories.length) {
      list.textContent = "Todavía no has guardado ningún recuerdo.";
      return;
    }

    for (const memory of memories) {
      const card = document.createElement("article");
      card.className = "memory-card";

      const date = document.createElement("small");
      date.textContent = new Date(memory.created_at).toLocaleString("es-ES");

      const content = document.createElement("p");
      content.textContent = memory.content;

      const remove = document.createElement("button");
      remove.className = "secondary";
      remove.textContent = "Eliminar";

      remove.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este recuerdo definitivamente?")) return;

        const { error } = await db
          .from("memories")
          .delete()
          .eq("id", memory.id)
          .eq("user_id", currentUser.id);

        if (error) {
          status("chat-status", "No se pudo eliminar el recuerdo.");
          return;
        }

        await renderMemories();
      });

      card.append(date, content, remove);
      list.appendChild(card);
    }
  } catch (error) {
    status("chat-status", error.message);
  }
}

$("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  status("login-message", "Iniciando sesión…");

  const email = $("email").value.trim();
  const password = $("password").value;

  try {
    const { data, error } = await db.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    currentUser = data.user;

    await setupEncryption(password);

    showApp(true);
    status("login-message", "");
    addMessage("Has iniciado sesión. Puedes guardar o consultar tus recuerdos.", "assistant");
  } catch (error) {
    memoryKey = null;
    currentUser = null;
    status("login-message", "No se pudo entrar: " + error.message);
  } finally {
    $("password").value = "";
  }
});

$("chat-form").addEventListener("submit", async event => {
  event.preventDefault();

  const prompt = $("prompt").value.trim();
  if (!prompt || !memoryKey) return;

  addMessage(prompt, "user");
  $("prompt").value = "";
  status("chat-status", "Procesando…");

  try {
    const normalized = prompt.toLocaleLowerCase("es");

    if (
      normalized.startsWith("guarda ") ||
      normalized.startsWith("añade ") ||
      normalized.startsWith("recuerda ")
    ) {
      await saveMemory(prompt);
      addMessage("Recuerdo guardado y cifrado correctamente.", "assistant");
    } else {
      const memories = await getMemories();
      const terms = normalized
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/\W+/)
        .filter(term => term.length > 2);

      const matches = memories.filter(memory => {
        const content = memory.content.toLocaleLowerCase("es")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");

        return terms.some(term => content.includes(term));
      });

      if (matches.length) {
        addMessage(
          matches.slice(0, 10).map(m => m.content).join("\n\n"),
          "assistant"
        );
      } else {
        addMessage(
          "No he encontrado un recuerdo coincidente. Puedes probar otras palabras o consultar Mis recuerdos.",
          "assistant"
        );
      }
    }

    status("chat-status", "");
  } catch (error) {
    status("chat-status", "Error: " + error.message);
  }
});

$("logout").addEventListener("click", async () => {
  memoryKey = null;
  keySalt = null;
  currentUser = null;
  await db.auth.signOut();
  $("messages").replaceChildren();
  showApp(false);
});

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});

showApp(false);
