"use strict";
const electron = require("electron");
const IPC_CHANNELS = {
  // Agent CRUD
  AGENTS_LIST: "agents:list",
  AGENTS_GET: "agents:get",
  AGENTS_CREATE: "agents:create",
  AGENTS_UPDATE: "agents:update",
  AGENTS_DELETE: "agents:delete",
  AGENTS_EXPORT: "agents:export",
  AGENTS_IMPORT: "agents:import",
  // Agent runner
  RUNNER_START: "runner:start",
  RUNNER_STOP: "runner:stop",
  RUNNER_EVENT: "runner:event",
  // main → renderer (pushed events)
  RUNNER_CONFIRM: "runner:confirm",
  // renderer → main (user confirmation response)
  // Settings
  SETTINGS_GET: "settings:get",
  SETTINGS_SET: "settings:set",
  SETTINGS_GET_SECRET: "settings:getSecret",
  SETTINGS_SET_SECRET: "settings:setSecret",
  SETTINGS_DELETE_SECRET: "settings:deleteSecret",
  SETTINGS_LIST_SECRET_KEYS: "settings:listSecretKeys",
  SETTINGS_TEST_PROVIDER: "settings:testProvider",
  // Audit log
  AUDIT_QUERY: "audit:query",
  AUDIT_CLEAR: "audit:clear"
};
async function invoke(channel, ...args) {
  return electron.ipcRenderer.invoke(channel, ...args);
}
const api = {
  // ── Agents ─────────────────────────────────────────────────────────────────
  agents: {
    list: () => invoke(IPC_CHANNELS.AGENTS_LIST),
    get: (id) => invoke(IPC_CHANNELS.AGENTS_GET, id),
    create: (payload) => invoke(IPC_CHANNELS.AGENTS_CREATE, payload),
    update: (payload) => invoke(IPC_CHANNELS.AGENTS_UPDATE, payload),
    delete: (id) => invoke(IPC_CHANNELS.AGENTS_DELETE, { id }),
    export: (id) => invoke(IPC_CHANNELS.AGENTS_EXPORT, id),
    import: (json) => invoke(IPC_CHANNELS.AGENTS_IMPORT, json)
  },
  // ── Runner ──────────────────────────────────────────────────────────────────
  runner: {
    start: (payload) => invoke(IPC_CHANNELS.RUNNER_START, payload),
    stop: (runId) => invoke(IPC_CHANNELS.RUNNER_STOP, { runId }),
    confirm: (payload) => invoke(IPC_CHANNELS.RUNNER_CONFIRM, payload),
    // Subscribe to runner events (streaming from main process)
    onEvent: (callback) => {
      const handler = (_, event) => callback(event);
      electron.ipcRenderer.on(IPC_CHANNELS.RUNNER_EVENT, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.RUNNER_EVENT, handler);
    }
  },
  // ── Settings ────────────────────────────────────────────────────────────────
  settings: {
    get: () => invoke(IPC_CHANNELS.SETTINGS_GET),
    set: (key, value) => invoke(IPC_CHANNELS.SETTINGS_SET, { key, value }),
    getSecretExists: (key) => invoke(IPC_CHANNELS.SETTINGS_GET_SECRET, key),
    setSecret: (key, value) => invoke(IPC_CHANNELS.SETTINGS_SET_SECRET, { key, value }),
    deleteSecret: (key) => invoke(IPC_CHANNELS.SETTINGS_DELETE_SECRET, key),
    listSecretKeys: () => invoke(IPC_CHANNELS.SETTINGS_LIST_SECRET_KEYS),
    testProvider: (payload) => invoke(IPC_CHANNELS.SETTINGS_TEST_PROVIDER, payload)
  },
  // ── Audit ───────────────────────────────────────────────────────────────────
  audit: {
    query: (params) => invoke(IPC_CHANNELS.AUDIT_QUERY, params),
    clear: (agentId) => invoke(IPC_CHANNELS.AUDIT_CLEAR, agentId)
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", api);
