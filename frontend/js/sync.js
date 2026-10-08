// Background refresh of show data from TMDB (new episodes, seasons, premiere dates).
import { api } from "./api.js";

let running = null;
const listeners = new Set();

export const onSynced = (fn) => listeners.add(fn);

export function runSync(force = false) {
  if (running) return running;
  const status = document.getElementById("sync-status");
  status.innerHTML = `<div class="spinner"></div><span>Checking for updates…</span>`;
  status.hidden = false;
  running = api
    .post(`/sync${force ? "?force=true" : ""}`)
    .then((result) => {
      listeners.forEach((fn) => fn(result));
      return result;
    })
    .finally(() => {
      running = null;
      status.hidden = true;
    });
  return running;
}
