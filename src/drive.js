const CLIENT_ID = '340117533444-n780bmbuad05nb8nld643gkle6d433t5.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const FOLDER_NAME = 'ShopList';
const LS_PERSONAL = 'shoplist_personal_id';
const LS_GROUPS   = 'shoplist_groups';
const DRIVE  = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

let _client      = null;
let _token       = null;
let _tokenExpiry = 0;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

function waitForGoogle() {
  return new Promise(resolve => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const id = setInterval(() => {
      if (window.google?.accounts?.oauth2) { clearInterval(id); resolve(); }
    }, 100);
  });
}

export async function init() {
  await waitForGoogle();
  _client = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: () => {},
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function requestToken(prompt) {
  return new Promise((resolve, reject) => {
    _client.callback = (resp) => {
      if (resp.error) { reject(new Error(resp.error_description ?? resp.error)); return; }
      _token = resp.access_token;
      _tokenExpiry = Date.now() + resp.expires_in * 1000 - 60_000;
      resolve(_token);
    };
    _client.requestAccessToken({ prompt });
  });
}

export const signIn = () => requestToken('select_account');

export function signOut() {
  if (_token) window.google.accounts.oauth2.revoke(_token, () => {});
  _token = null;
  _tokenExpiry = 0;
}

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  return requestToken('');
}

async function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${await getToken()}`, ...extra };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getShortCode(fileId) {
  return (fileId || '').substring(0, 8).toUpperCase();
}

// ── Drive folder ──────────────────────────────────────────────────────────────

async function findOrCreateFolder() {
  const h = await authHeaders();
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const r = await fetch(`${DRIVE}?q=${q}&fields=files(id)`, { headers: h });
  if (!r.ok) throw new Error(`Folder search failed: ${r.status}`);
  const { files } = await r.json();
  if (files?.length) return files[0].id;

  const cr = await fetch(DRIVE, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!cr.ok) throw new Error(`Folder create failed: ${cr.status}`);
  return (await cr.json()).id;
}

async function createDriveFile(fileName, initialData) {
  const folderId = await findOrCreateFolder();
  const h = await authHeaders();
  const meta = { name: fileName, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file',     new Blob([JSON.stringify(initialData)], { type: 'application/json' }));
  const r = await fetch(`${UPLOAD}?uploadType=multipart`, { method: 'POST', headers: h, body: form });
  if (!r.ok) throw new Error(`File create failed: ${r.status}`);
  return (await r.json()).id;
}

async function readDriveFile(fileId) {
  const h = await authHeaders();
  const r = await fetch(`${DRIVE}/${fileId}?alt=media`, { headers: h });
  if (!r.ok) return { lists: [] };
  try { return await r.json(); } catch { return { lists: [] }; }
}

async function writeDriveFile(fileId, data) {
  const h = await authHeaders();
  const r = await fetch(`${UPLOAD}/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Save failed: ${r.status}`);
}

// ── Personal file (private, no sharing) ──────────────────────────────────────

export function getPersonalFileId() {
  return localStorage.getItem(LS_PERSONAL) || null;
}

export async function ensurePersonalFile() {
  let id = getPersonalFileId();
  if (id) return id;
  id = await createDriveFile('personal.json', { lists: [] });
  localStorage.setItem(LS_PERSONAL, id);
  return id;
}

export async function loadPersonalData() {
  const id = getPersonalFileId();
  if (!id) return { lists: [] };
  return readDriveFile(id);
}

export async function savePersonalData(data) {
  const id = getPersonalFileId();
  if (!id) throw new Error('No personal file.');
  await writeDriveFile(id, data);
}

// ── Shared groups (anyone:writer via file ID) ─────────────────────────────────

/** Returns [{name, fileId}] from localStorage. */
export function getStoredGroups() {
  try { return JSON.parse(localStorage.getItem(LS_GROUPS) || '[]'); } catch { return []; }
}

/** Persists the groups array to localStorage. */
export function persistGroups(groups) {
  localStorage.setItem(LS_GROUPS, JSON.stringify(groups));
}

/**
 * Creates a new shared group file with anyone:writer permission.
 * Returns { name, fileId }.
 */
export async function createGroup(name) {
  const safe = name.trim().replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const fileName = `shared-${safe}-${Date.now()}.json`;
  const fileId = await createDriveFile(fileName, { lists: [] });
  const h = await authHeaders();
  const pr = await fetch(`${DRIVE}/${fileId}/permissions`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'writer', type: 'anyone' }),
  });
  if (!pr.ok) throw new Error(`Permission set failed: ${pr.status}`);
  return { name: name.trim(), fileId };
}

/**
 * Validates access to an existing shared group file.
 * Returns the file's data on success.
 */
export async function joinGroup(fileId) {
  if (!fileId?.trim()) throw new Error('Enter a join code.');
  const id = fileId.trim();
  const h = await authHeaders();
  const r = await fetch(`${DRIVE}/${id}?alt=media`, { headers: h });
  if (r.status === 404) throw new Error('File not found. Check the join code.');
  if (r.status === 403) throw new Error('Access denied. Make sure the code is correct.');
  if (!r.ok) throw new Error(`Cannot access file (${r.status}).`);
  try { return await r.json(); } catch { return { lists: [] }; }
}

export async function loadGroupData(fileId) {
  return readDriveFile(fileId);
}

export async function saveGroupData(fileId, data) {
  await writeDriveFile(fileId, data);
}

// ── User info ─────────────────────────────────────────────────────────────────

export async function getUserInfo() {
  const h = await authHeaders();
  const r = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', { headers: h });
  if (!r.ok) return null;
  return r.json();
}
