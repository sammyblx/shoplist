const CLIENT_ID = '340117533444-n780bmbuad05nb8nld643gkle6d433t5.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');
const FILE_NAME = 'shoplist.json';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

let _client = null;
let _token = null;
let _tokenExpiry = 0;
let _fileId = null;   // cached Drive file id
let _fileIdChecked = false; // true after first lookup (even if null)

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

function requestToken(prompt) {
  return new Promise((resolve, reject) => {
    _client.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error_description ?? resp.error));
        return;
      }
      _token = resp.access_token;
      _tokenExpiry = Date.now() + resp.expires_in * 1000 - 60_000;
      resolve(_token);
    };
    _client.requestAccessToken({ prompt });
  });
}

/** Opens the Google account chooser. Call on user-initiated sign-in. */
export function signIn() {
  return requestToken('select_account');
}

export function signOut() {
  if (_token) window.google.accounts.oauth2.revoke(_token, () => {});
  _token = null;
  _tokenExpiry = 0;
  _fileId = null;
  _fileIdChecked = false;
}

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  // silent refresh — no popup
  return requestToken('');
}

async function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${await getToken()}`, ...extra };
}

async function resolveFileId() {
  if (_fileIdChecked) return _fileId;
  const h = await authHeaders();
  const r = await fetch(
    `${DRIVE}?spaces=appDataFolder&q=name%3D'${FILE_NAME}'&fields=files(id)`,
    { headers: h }
  );
  if (!r.ok) throw new Error(`Drive list failed: ${r.status}`);
  const { files } = await r.json();
  _fileId = files?.[0]?.id ?? null;
  _fileIdChecked = true;
  return _fileId;
}

/** Returns parsed JSON from shoplist.json, or { lists: [] } if not found. */
export async function loadData() {
  const id = await resolveFileId();
  if (!id) return { lists: [] };
  const h = await authHeaders();
  const r = await fetch(`${DRIVE}/${id}?alt=media`, { headers: h });
  if (r.status === 404) {
    // File was deleted externally — reset cache
    _fileId = null;
    _fileIdChecked = false;
    return { lists: [] };
  }
  if (!r.ok) return { lists: [] };
  try { return await r.json(); } catch { return { lists: [] }; }
}

/** Writes data to shoplist.json, creating it if needed. */
export async function saveData(data) {
  const h = await authHeaders();
  const body = JSON.stringify(data);
  const id = await resolveFileId();

  if (!id) {
    const meta = { name: FILE_NAME, parents: ['appDataFolder'] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', new Blob([body], { type: 'application/json' }));
    const r = await fetch(`${UPLOAD}?uploadType=multipart`, {
      method: 'POST',
      headers: h,
      body: form,
    });
    if (!r.ok) throw new Error(`Drive create failed: ${r.status}`);
    const d = await r.json();
    _fileId = d.id;
    _fileIdChecked = true;
  } else {
    const r = await fetch(`${UPLOAD}/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: { ...h, 'Content-Type': 'application/json' },
      body,
    });
    if (!r.ok) throw new Error(`Drive save failed: ${r.status}`);
  }
}

/** Returns basic profile info: { name, email, picture }. */
export async function getUserInfo() {
  const h = await authHeaders();
  const r = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', { headers: h });
  if (!r.ok) return null;
  return r.json();
}
