// Settings: TMDB key, manual refresh, export/import.
import { api } from "../api.js";
import { icon } from "../icons.js";
import { esc, toast } from "../ui.js";
import { runSync } from "../sync.js";

export async function render(root) {
  const settings = await api.get("/settings");
  root.innerHTML = `
    <h1 class="page-title">Settings</h1>
    <div class="settings">
      <section class="panel">
        <h2>TMDB API key ${settings.has_api_key ? `<span class="badge badge-success">${icon("check", 12)} Connected</span>` : ""}</h2>
        <p>MovieTracker gets show and movie information from TMDB (The Movie Database). The key is free:</p>
        <ol>
          <li>Create an account at <a class="link" href="https://www.themoviedb.org/signup" target="_blank" rel="noopener">themoviedb.org</a>.</li>
          <li>Open <a class="link" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">Settings → API</a> and request a key for personal use.</li>
          <li>Copy the <b>API Key</b> (or the longer <b>API Read Access Token</b>) and paste it here.</li>
        </ol>
        ${settings.api_key_from_env
          ? `<p>Using the key from the <code>TMDB_API_KEY</code> environment variable.</p>`
          : `<form class="form-row" id="key-form">
              <input class="input" id="key" type="password" autocomplete="off" spellcheck="false"
                     placeholder="${settings.has_api_key ? "Paste a new key to replace the current one" : "Paste your TMDB API key"}">
              <button class="btn btn-primary" type="submit">Save</button>
            </form>`}
      </section>

      <section class="panel">
        <h2>Updates</h2>
        <p>New episodes, announced seasons and premiere dates are checked automatically whenever you open MovieTracker.</p>
        <button class="btn" id="sync-now" ${settings.has_api_key ? "" : "disabled"}>${icon("refresh", 16)} Check everything now</button>
      </section>

      <section class="panel">
        <h2>Backup</h2>
        <p>Your library lives in <code>${esc(settings.data_dir)}</code>, and a copy of it is saved in the <code>backups</code> folder there every day.
           You can also export it to a file, e.g. to move it to another computer.</p>
        <div class="form-row">
          <a class="btn" href="/api/export" download>${icon("download", 16)} Export library</a>
          <label class="btn" ${settings.has_api_key ? "" : "hidden"}>${icon("upload", 16)} Import backup
            <input type="file" id="import-file" accept=".json,application/json" hidden>
          </label>
        </div>
      </section>

      <section class="panel">
        <h2>About</h2>
        <p>MovieTracker is a free, open-source tracker that runs on your own computer.
           Show and movie data and images come from <a class="link" href="https://www.themoviedb.org/" target="_blank" rel="noopener">TMDB</a>.
           This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </section>
    </div>`;

  root.querySelector("#key-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = root.querySelector("#key");
    const button = e.target.querySelector("button");
    if (!input.value.trim()) return;
    button.disabled = true;
    button.textContent = "Checking…";
    try {
      await api.put("/settings", { tmdb_api_key: input.value });
      toast("API key saved. You're ready to go!");
      location.hash = "#/";
    } catch (err) {
      toast(err.message, { type: "error" });
      button.disabled = false;
      button.textContent = "Save";
    }
  });

  root.querySelector("#sync-now").addEventListener("click", async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      const r = await runSync(true);
      const parts = [`${r.shows} shows`, `${r.movies} movies`, `${r.updates} new updates`];
      toast(`Refreshed ${parts.join(", ")}${r.errors.length ? ` (${r.errors.length} problem${r.errors.length > 1 ? "s" : ""})` : ""}`);
    } catch (err) {
      toast(err.message, { type: "error" });
    }
    button.disabled = false;
  });

  root.querySelector("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      toast("That file isn't valid JSON.", { type: "error" });
      return;
    }
    toast("Importing… this can take a minute for big libraries.");
    try {
      const r = await api.post("/import", payload);
      toast(`Imported ${r.shows} shows and ${r.movies} movies${r.errors.length ? ` (${r.errors.length} couldn't be imported)` : ""}`);
      if (r.errors.length) console.warn("Import problems:", r.errors);
    } catch (err) {
      toast(err.message, { type: "error" });
    }
    e.target.value = "";
  });
}
