const CLIENT_ID = '340117533444-n780bmbuad05nb8nld643gkle6d433t5.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const FOLDER_NAME = 'ShopList';
const FILE_NAME   = 'shoplist.json';
const LS_KEY      = 'shoplist_file_id';
const DRIVE       = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD      = 'https://www.googleapis.com/upload/drive/v3/files';

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

/** Call once on app start. Resolves when the GIS library is ready. */
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

/** Opens the Google account chooser. Call on user-initiated sign-in. */
export const signIn = () => requestToken('select_account');

/** Revokes the token. Does NOT clear the saved file ID so the user rejoins automatically. */
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

// ── Join code helpers ─────────────────────────────────────────────────────────

/** Returns the saved Drive file ID, or null. */
export function getSavedFileId() {
  return localStorage.getItem(LS_KEY) || null;
}

/** The short human-readable code — first 8 chars of the file ID. */
export function getShortCode(fileId) {
  return (fileId || '').substring(0, 8).toUpperCase();
}

/** Remove the saved file ID (user leaves the family list). */
export function clearSavedFileId() {
  localStorage.removeItem(LS_KEY);
}

// ── Drive folder + file management ───────────────────────────────────────────

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

/**
 * Creates a new ShopList folder + shoplist.json, sets anyone-can-write
 * permission, saves file ID to localStorage.
 * Returns { fileId, data }.
 */
export async function createFamilyFile() {
  const folderId = await findOrCreateFolder();
  const h = await authHeaders();

  const meta = { name: FILE_NAME, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file',     new Blob([JSON.stringify({ lists: [] })], { type: 'application/json' }));

  const r = await fetch(`${UPLOAD}?uploadType=multipart`, { method: 'POST', headers: h, body: form });
  if (!r.ok) throw new Error(`File create failed: ${r.status}`);
  const { id: fileId } = await r.json();

  // Allow anyone with the link to edit — required for family sharing
  const pr = await fetch(`${DRIVE}/${fileId}/permissions`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'writer', type: 'anyone' }),
  });
  if (!pr.ok) throw new Error(`Permission set failed: ${pr.status}`);

  localStorage.setItem(LS_KEY, fileId);
  return { fileId, data: { lists: [] } };
}

/**
 * Joins an existing family file by ID. Validates access, saves file ID
 * to localStorage. Returns the current data.
 */
export async function joinFamily(fileId) {
  if (!fileId?.trim()) throw new Error('Enter a join code.');
  const id = fileId.trim();
  const h = await authHeaders();
  const r = await fetch(`${DRIVE}/${id}?alt=media`, { headers: h });
  if (r.status === 404) throw new Error('File not found. Check the join code.');
  if (r.status === 403) throw new Error('Access denied. Make sure the code is correct and the list owner has shared it.');
  if (!r.ok) throw new Error(`Cannot access file (${r.status}).`);
  let data;
  try { data = await r.json(); } catch { data = { lists: [] }; }
  localStorage.setItem(LS_KEY, id);
  return data;
}

// ── Data I/O ──────────────────────────────────────────────────────────────────

/** Loads data from the file ID stored in localStorage. */
export async function loadData() {
  const fileId = getSavedFileId();
  if (!fileId) throw new Error('No file ID saved.');
  const h = await authHeaders();
  const r = await fetch(`${DRIVE}/${fileId}?alt=media`, { headers: h });
  if (!r.ok) return { lists: [] };
  try { return await r.json(); } catch { return { lists: [] }; }
}

/** Saves data to the file ID stored in localStorage. */
export async function saveData(data) {
  const fileId = getSavedFileId();
  if (!fileId) throw new Error('No file ID saved.');
  const h = await authHeaders();
  const r = await fetch(`${UPLOAD}/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Save failed: ${r.status}`);
}

/** Returns basic profile info: { name, email, picture }. */
export async function getUserInfo() {
  const h = await authHeaders();
  const r = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', { headers: h });
  if (!r.ok) return null;
  return r.json();
}
