
"use strict";

const MemoryCrypto = (() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function toBase64(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function fromBase64(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, c => c.charCodeAt(0));
  }

  async function deriveKey(password, salt) {
    if (!password || password.length < 12) {
      throw new Error(
        "Usa una contraseña de al menos 12 caracteres."
      );
    }

    const material = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 600000,
        hash: "SHA-256"
      },
      material,
      {
        name: "AES-GCM",
        length: 256
      },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function createKey(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);

    return {
      key,
      salt: toBase64(salt)
    };
  }

  async function unlockKey(password, saltBase64) {
    return deriveKey(password, fromBase64(saltBase64));
  }

  async function encrypt(text, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(text)
    );

    return {
      encrypted_content: toBase64(new Uint8Array(ciphertext)),
      iv: toBase64(iv)
    };
  }

  async function decrypt(ciphertextBase64, ivBase64, key) {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(ivBase64)
      },
      key,
      fromBase64(ciphertextBase64)
    );

    return decoder.decode(plaintext);
  }

  return {
    createKey,
    unlockKey,
    encrypt,
    decrypt
  };
})();
