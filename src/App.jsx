import { useState, useEffect, useRef, useCallback } from 'react';
import * as Drive from './drive.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
function uid() { return crypto.randomUUID(); }

function getAge(dateStr) {
  const days = Math.floor((Date.now() - new Date(dateStr)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function isOlderThan2Months(dateStr) {
  return Date.now() - new Date(dateStr) > 60 * 86400000;
}

function normalise(str) {
  return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildCrossListMap(currentList, allLists) {
  const otherLists = allLists.filter(l => l.id !== currentList.id);
  const result = new Map();
  for (const item of currentList.items) {
    const key = normalise(item.name);
    const matches = [];
    for (const list of otherLists) {
      const found = list.items.find(i => normalise(i.name) === key);
      if (found) matches.push({ listName: list.name, listId: list.id, checked: found.checked });
    }
    if (matches.length > 0) result.set(item.id, matches);
  }
  return result;
}

function buildMissingElsewhereData(currentList, allLists) {
  const otherLists = allLists.filter(l => l.id !== currentList.id);
  const coveredElsewhere = [];
  const neededElsewhere = [];
  const uniqueToThis = [];
  for (const item of currentList.items) {
    if (item.checked) continue;
    const key = normalise(item.name);
    const matchingOthers = [];
    for (const list of otherLists) {
      const found = list.items.find(i => normalise(i.name) === key);
      if (found) matchingOthers.push({ listName: list.name, listId: list.id, checked: found.checked });
    }
    if (matchingOthers.length === 0) {
      uniqueToThis.push({ item, matchingOthers: [] });
    } else if (matchingOthers.every(m => m.checked)) {
      coveredElsewhere.push({ item, matchingOthers });
    } else {
      neededElsewhere.push({ item, matchingOthers });
    }
  }
  return { coveredElsewhere, neededElsewhere, uniqueToThis };
}

// ── Section (collapsible card) ────────────────────────────────────────────────
function Section({ title, subtitle, color, bg, border, count, expanded, onToggle, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      <button onClick={onToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: bg, border: 'none', borderBottom: `1px solid ${border}`, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color }}>{title}</div>
          <div style={{ fontSize: 12, color, opacity: 0.75, marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ background: color, color: '#fff', borderRadius: 20, padding: '2px 10px', fontSize: 13, fontWeight: 700 }}>{count}</span>
          <span style={{ fontSize: 18, color, fontWeight: 700, lineHeight: 1 }}>{expanded ? '−' : '+'}</span>
        </div>
      </button>
      {expanded && <div style={{ padding: count === 0 ? 0 : '8px 0' }}>{children}</div>}
    </div>
  );
}

// ── CrossItem ─────────────────────────────────────────────────────────────────
function CrossItem({ item, matches, onToggle }) {
  return (
    <div
      style={{ padding: '11px 18px', display: 'flex', alignItems: 'flex-start', gap: 12, borderBottom: '1px solid #f3f4f6' }}
      onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
      onMouseLeave={e => e.currentTarget.style.background = ''}
    >
      <button onClick={onToggle} style={{ width: 20, height: 20, marginTop: 2, borderRadius: 5, border: item.checked ? 'none' : '2px solid #d1d5db', background: item.checked ? '#22c55e' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
        {item.checked && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
      </button>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 500, color: item.checked ? '#9ca3af' : '#111827', textDecoration: item.checked ? 'line-through' : 'none' }}>{item.name}</span>
          {(item.qty > 0 || item.unit) && (
            <span style={{ fontSize: 12, color: '#9ca3af', fontFamily: "'DM Mono',monospace" }}>{item.qty} {item.unit}</span>
          )}
        </div>
        {matches.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
            {matches.map((m, i) => (
              <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600, background: m.checked ? '#f0fdf4' : '#fff7ed', color: m.checked ? '#16a34a' : '#c2410c', border: `1px solid ${m.checked ? '#bbf7d0' : '#fed7aa'}` }}>
                {m.checked ? '✓' : '○'} {m.listName}
              </span>
            ))}
          </div>
        )}
        {matches.length === 0 && (
          <div style={{ fontSize: 11, color: '#93c5fd', marginTop: 4 }}>Only in this list</div>
        )}
      </div>
    </div>
  );
}

// ── EmptyNote ─────────────────────────────────────────────────────────────────
function EmptyNote({ children }) {
  return <div style={{ padding: '18px 18px', color: '#9ca3af', fontSize: 13 }}>{children}</div>;
}

// ── LoginScreen ───────────────────────────────────────────────────────────────
function LoginScreen({ onSignIn, loading, error, ready }) {
  return (
    <div style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif", minHeight: '100vh', background: '#f0f2f5', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 20px', height: 58, display: 'flex', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 18, color: '#111827', letterSpacing: '-0.5px' }}>🛒 ShopList</span>
      </header>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: '#fff', borderRadius: 20, padding: '44px 36px', maxWidth: 380, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #e5e7eb', textAlign: 'center' }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>🛒</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#111827', margin: '0 0 10px', letterSpacing: '-0.5px' }}>ShopList</h1>
          <p style={{ fontSize: 15, color: '#6b7280', margin: '0 0 30px', lineHeight: 1.6 }}>
            Multiple shopping lists,<br />synced to your Google Drive.
          </p>
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#dc2626', textAlign: 'left' }}>
              {error}
            </div>
          )}
          <button
            onClick={onSignIn}
            disabled={loading || !ready}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '13px 20px', background: loading || !ready ? '#f9fafb' : '#fff', border: '1.5px solid #e5e7eb', borderRadius: 12, fontSize: 15, fontWeight: 600, color: loading || !ready ? '#9ca3af' : '#111827', cursor: loading || !ready ? 'not-allowed' : 'pointer', transition: 'all .15s', fontFamily: "'DM Sans','Segoe UI',sans-serif" }}
          >
            {loading ? (
              <span>Signing in…</span>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Sign in with Google
              </>
            )}
          </button>
          {!ready && <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 12 }}>Loading Google Sign-In…</p>}
          <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 20, lineHeight: 1.6 }}>
            Your data is stored privately in your own Google Drive appdata folder. No backend servers.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [lists, setLists] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('items');
  const [newListName, setNewListName] = useState('');
  const [showNewList, setShowNewList] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', qty: 1, unit: '' });
  const [showAddItem, setShowAddItem] = useState(false);
  const [toast, setToast] = useState(null);
  const [autoDeleted, setAutoDeleted] = useState([]);
  const [showDeletedBanner, setShowDeletedBanner] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [missingExpanded, setMissingExpanded] = useState({ coveredElsewhere: true, neededElsewhere: true, uniqueToThis: false });

  // Drive / auth state
  const [user, setUser] = useState(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    Drive.init().then(() => setReady(true)).catch(() => {});
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, []);

  // Debounced save to Drive
  const scheduleSave = useCallback((nextLists) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try { await Drive.saveData({ lists: nextLists }); }
      catch { showToast('Auto-save failed', 'error'); }
      finally { setSaving(false); }
    }, 1500);
  }, []);

  // Wrapper: mutate lists array and schedule a Drive save
  const updateLists = useCallback((fn) => {
    setLists(prev => {
      const next = fn(prev);
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  // ── Auth ──────────────────────────────────────────────────────────────────
  async function handleSignIn() {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await Drive.signIn();
      const [data, userInfo] = await Promise.all([Drive.loadData(), Drive.getUserInfo()]);
      const allLists = data.lists || [];
      const oldLists = allLists.filter(l => isOlderThan2Months(l.createdAt));
      const prunedLists = allLists.filter(l => !isOlderThan2Months(l.createdAt));
      setLists(prunedLists);
      setActiveId(prunedLists[0]?.id ?? null);
      setUser(userInfo);
      setLoggedIn(true);
      if (oldLists.length > 0) {
        setAutoDeleted(oldLists.map(l => l.name));
        setShowDeletedBanner(true);
        await Drive.saveData({ lists: prunedLists });
      }
    } catch (e) {
      setAuthError(e.message === 'access_denied' ? 'Sign-in was cancelled.' : e.message);
    } finally {
      setAuthLoading(false);
    }
  }

  function handleSignOut() {
    Drive.signOut();
    setLists([]);
    setUser(null);
    setLoggedIn(false);
    setActiveId(null);
    setAuthError(null);
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  }

  // ── List CRUD ─────────────────────────────────────────────────────────────
  function createList() {
    if (!newListName.trim()) return;
    const list = { id: uid(), name: newListName.trim(), createdAt: new Date().toISOString(), items: [] };
    updateLists(prev => [list, ...prev]);
    setActiveId(list.id);
    setNewListName('');
    setShowNewList(false);
    setSidebarOpen(false);
    showToast(`"${list.name}" created`);
  }

  function deleteList(id) {
    const name = lists.find(l => l.id === id)?.name;
    const remaining = lists.filter(l => l.id !== id);
    updateLists(() => remaining);
    if (activeId === id) setActiveId(remaining[0]?.id ?? null);
    showToast(`"${name}" deleted`, 'error');
  }

  // ── Item CRUD ─────────────────────────────────────────────────────────────
  function addItem() {
    if (!newItem.name.trim()) return;
    const item = { id: uid(), ...newItem, name: newItem.name.trim(), checked: false };
    updateLists(prev => prev.map(l => l.id === activeId ? { ...l, items: [...l.items, item] } : l));
    setNewItem({ name: '', qty: 1, unit: '' });
    setShowAddItem(false);
    showToast(`"${item.name}" added`);
  }

  function toggleItem(itemId) {
    updateLists(prev =>
      prev.map(l =>
        l.id === activeId
          ? { ...l, items: l.items.map(i => i.id === itemId ? { ...i, checked: !i.checked } : i) }
          : l
      )
    );
  }

  function removeItem(itemId) {
    const name = lists.find(l => l.id === activeId)?.items.find(i => i.id === itemId)?.name;
    updateLists(prev => prev.map(l => l.id === activeId ? { ...l, items: l.items.filter(i => i.id !== itemId) } : l));
    showToast(`"${name}" removed`, 'error');
  }

  function saveEdit(itemId) {
    updateLists(prev =>
      prev.map(l =>
        l.id === activeId
          ? { ...l, items: l.items.map(i => i.id === itemId ? { ...i, ...editingItem } : i) }
          : l
      )
    );
    setEditingItem(null);
    showToast('Item updated');
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeList = lists.find(l => l.id === activeId);
  const crossData = activeList ? buildMissingElsewhereData(activeList, lists) : null;
  const crossMap = activeList ? buildCrossListMap(activeList, lists) : new Map();
  const attentionCount = crossData ? crossData.coveredElsewhere.length + crossData.neededElsewhere.length : 0;
  const checkedCount = activeList?.items.filter(i => i.checked).length ?? 0;
  const totalCount = activeList?.items.length ?? 0;

  // ── Login gate ────────────────────────────────────────────────────────────
  if (!loggedIn) {
    return <LoginScreen onSignIn={handleSignIn} loading={authLoading} error={authError} ready={ready} />;
  }

  // ── Main app ──────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif", minHeight: '100vh', background: '#f0f2f5', display: 'flex', flexDirection: 'column' }}>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 18, left: '50%', transform: 'translateX(-50%)', background: toast.type === 'error' ? '#ef4444' : '#22c55e', color: '#fff', padding: '10px 22px', borderRadius: 40, zIndex: 9999, fontWeight: 600, fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', animation: 'fadeSlide .25s ease', whiteSpace: 'nowrap' }}>
          {toast.msg}
        </div>
      )}

      {/* Auto-delete banner */}
      {showDeletedBanner && (
        <div style={{ background: '#fef3c7', borderBottom: '1px solid #fde68a', padding: '10px 20px', fontSize: 13, color: '#92400e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>🗑 Auto-deleted {autoDeleted.length} old list(s): <b>{autoDeleted.join(', ')}</b> (older than 2 months)</span>
          <button onClick={() => setShowDeletedBanner(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#92400e' }}>✕</button>
        </div>
      )}

      {/* Header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 20px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', padding: 4, borderRadius: 8, color: '#374151' }}>☰</button>
          <span style={{ fontWeight: 700, fontSize: 18, color: '#111827', letterSpacing: '-0.5px' }}>🛒 ShopList</span>
          {saving && (
            <span title="Saving…" style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 1s ease-in-out infinite' }} />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => { setShowNewList(true); setSidebarOpen(true); }}
            style={{ background: '#111827', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            + New List
          </button>
          {user?.picture ? (
            <img
              src={user.picture}
              alt={user.name ?? 'User'}
              title={`${user.name ?? ''} — click to sign out`}
              referrerPolicy="no-referrer"
              onClick={handleSignOut}
              style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid #e5e7eb', cursor: 'pointer' }}
            />
          ) : (
            <button onClick={handleSignOut} style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 12px', fontSize: 13, color: '#6b7280', cursor: 'pointer', fontFamily: 'inherit' }}>
              Sign out
            </button>
          )}
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, position: 'relative' }}>

        {/* Sidebar overlay */}
        {sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200 }} />
        )}

        {/* Sidebar */}
        <aside style={{ position: 'fixed', top: 58, left: 0, bottom: 0, zIndex: 300, width: 270, background: '#fff', borderRight: '1px solid #e5e7eb', transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform .25s ease', overflowY: 'auto', padding: '12px 0' }}>
          {showNewList && (
            <div style={{ margin: '0 12px 12px', background: '#f9fafb', borderRadius: 12, padding: 14, border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>New List</div>
              <input
                autoFocus
                value={newListName}
                onChange={e => setNewListName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createList()}
                placeholder="List name…"
                style={{ width: '100%', border: '1.5px solid #d1d5db', borderRadius: 8, padding: '8px 10px', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 8, fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={createList} style={{ flex: 1, background: '#111827', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 0', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Create</button>
                <button onClick={() => { setShowNewList(false); setNewListName(''); }} style={{ flex: 1, background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 8, padding: '8px 0', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              </div>
            </div>
          )}

          <div style={{ padding: '0 12px 6px', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 }}>Your Lists</div>

          {lists.length === 0 && (
            <div style={{ padding: '20px 16px', color: '#9ca3af', fontSize: 14, textAlign: 'center' }}>No lists yet.</div>
          )}

          {lists.map(list => {
            const unchecked = list.items.filter(i => !i.checked).length;
            return (
              <div
                key={list.id}
                onClick={() => { setActiveId(list.id); setSidebarOpen(false); setActiveTab('items'); }}
                style={{ margin: '2px 8px', borderRadius: 10, padding: '11px 14px', cursor: 'pointer', background: activeId === list.id ? '#f0fdf4' : 'transparent', border: activeId === list.id ? '1.5px solid #bbf7d0' : '1.5px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'space-between', transition: 'all .15s' }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{list.name}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{unchecked} remaining · {getAge(list.createdAt)}</div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); deleteList(list.id); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: '#d1d5db', padding: 4, borderRadius: 6 }}
                >🗑</button>
              </div>
            );
          })}

          <div style={{ margin: '16px 12px 4px', padding: '10px 14px', background: '#fef3c7', borderRadius: 10, fontSize: 12, color: '#92400e' }}>
            <b>⚡ Drive Sync:</b> Changes save to your Google Drive appdata folder automatically.
          </div>
          <div style={{ margin: '6px 12px 12px', padding: '10px 14px', background: '#eff6ff', borderRadius: 10, fontSize: 12, color: '#1e40af' }}>
            <b>🗑 Auto-clean:</b> Lists older than 2 months are deleted automatically.
          </div>
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, padding: '20px', maxWidth: 680, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
          {!activeList ? (
            <div style={{ textAlign: 'center', marginTop: 80, color: '#9ca3af' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🛒</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#374151' }}>No list selected</div>
              <div style={{ fontSize: 14, marginTop: 6 }}>Create a new list to get started</div>
            </div>
          ) : (
            <>
              {/* List header card */}
              <div style={{ background: '#fff', borderRadius: 16, padding: '20px 22px', marginBottom: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#111827', letterSpacing: '-0.5px' }}>{activeList.name}</h1>
                    <div style={{ marginTop: 5, fontSize: 13, color: '#6b7280' }}>Created {getAge(activeList.createdAt)} · {totalCount} items</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: checkedCount === totalCount && totalCount > 0 ? '#16a34a' : '#374151' }}>{checkedCount}/{totalCount}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>checked</div>
                  </div>
                </div>
                <div style={{ marginTop: 14, background: '#f3f4f6', borderRadius: 100, height: 6, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${totalCount > 0 ? (checkedCount / totalCount) * 100 : 0}%`, background: checkedCount === totalCount && totalCount > 0 ? '#22c55e' : '#111827', borderRadius: 100, transition: 'width .4s ease' }} />
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: '#fff', borderRadius: 12, padding: 4, border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                <button
                  onClick={() => setActiveTab('items')}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14, background: activeTab === 'items' ? '#111827' : 'transparent', color: activeTab === 'items' ? '#fff' : '#6b7280', transition: 'all .15s', fontFamily: 'inherit' }}
                >
                  📋 Items
                </button>
                <button
                  onClick={() => setActiveTab('missing')}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14, background: activeTab === 'missing' ? '#111827' : 'transparent', color: activeTab === 'missing' ? '#fff' : '#6b7280', transition: 'all .15s', position: 'relative', fontFamily: 'inherit' }}
                >
                  🔍 Cross-List
                  {attentionCount > 0 && (
                    <span style={{ position: 'absolute', top: 5, right: 12, background: '#f59e0b', color: '#fff', borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{attentionCount}</span>
                  )}
                </button>
              </div>

              {/* ── ITEMS TAB ── */}
              {activeTab === 'items' && (
                <>
                  <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 12 }}>
                    {activeList.items.length === 0 && (
                      <div style={{ padding: '32px 20px', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>No items yet. Add one below!</div>
                    )}
                    {activeList.items.map((item, idx) => {
                      const crossInfo = crossMap.get(item.id);
                      return (
                        <div key={item.id}>
                          {idx > 0 && <div style={{ height: 1, background: '#f3f4f6', margin: '0 16px' }} />}
                          {editingItem?.id === item.id ? (
                            /* Edit row */
                            <div style={{ padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <input
                                autoFocus
                                value={editingItem.name}
                                onChange={e => setEditingItem({ ...editingItem, name: e.target.value })}
                                style={{ flex: 2, border: '1.5px solid #d1d5db', borderRadius: 8, padding: '6px 10px', fontSize: 14, minWidth: 100, fontFamily: 'inherit' }}
                              />
                              <input
                                type="number"
                                value={editingItem.qty}
                                onChange={e => setEditingItem({ ...editingItem, qty: e.target.value })}
                                style={{ width: 56, border: '1.5px solid #d1d5db', borderRadius: 8, padding: '6px 10px', fontSize: 14, fontFamily: "'DM Mono',monospace" }}
                              />
                              <input
                                value={editingItem.unit}
                                onChange={e => setEditingItem({ ...editingItem, unit: e.target.value })}
                                placeholder="unit"
                                style={{ width: 64, border: '1.5px solid #d1d5db', borderRadius: 8, padding: '6px 10px', fontSize: 14, fontFamily: 'inherit' }}
                              />
                              <button onClick={() => saveEdit(item.id)} style={{ background: '#111827', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Save</button>
                              <button onClick={() => setEditingItem(null)} style={{ background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 8, padding: '6px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                            </div>
                          ) : (
                            /* Item row */
                            <div
                              style={{ padding: '11px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}
                              onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                              onMouseLeave={e => e.currentTarget.style.background = ''}
                            >
                              <button
                                onClick={() => toggleItem(item.id)}
                                style={{ width: 22, height: 22, marginTop: 2, borderRadius: 6, border: item.checked ? 'none' : '2px solid #d1d5db', background: item.checked ? '#22c55e' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}
                              >
                                {item.checked && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>✓</span>}
                              </button>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 15, fontWeight: 500, color: item.checked ? '#9ca3af' : '#111827', textDecoration: item.checked ? 'line-through' : 'none', transition: 'all .2s' }}>{item.name}</span>
                                  {(item.qty > 0 || item.unit) && (
                                    <span style={{ fontSize: 12, color: '#9ca3af', fontFamily: "'DM Mono',monospace" }}>{item.qty} {item.unit}</span>
                                  )}
                                </div>
                                {crossInfo && !item.checked && (
                                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                                    {crossInfo.map((c, i) => (
                                      <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600, background: c.checked ? '#f0fdf4' : '#fff7ed', color: c.checked ? '#16a34a' : '#c2410c', border: `1px solid ${c.checked ? '#bbf7d0' : '#fed7aa'}` }}>
                                        {c.checked ? '✓' : '○'} {c.listName}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                <button onClick={() => setEditingItem({ ...item })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#9ca3af', padding: '4px 6px', borderRadius: 6 }} title="Edit">✏️</button>
                                <button onClick={() => removeItem(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#fca5a5', padding: '4px 6px', borderRadius: 6 }} title="Remove">✕</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {showAddItem ? (
                    <div style={{ background: '#fff', borderRadius: 16, padding: 16, border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Add Item</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <input
                          autoFocus
                          value={newItem.name}
                          onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                          onKeyDown={e => e.key === 'Enter' && addItem()}
                          placeholder="Item name…"
                          style={{ flex: 2, border: '1.5px solid #d1d5db', borderRadius: 10, padding: '9px 12px', fontSize: 14, outline: 'none', minWidth: 120, fontFamily: 'inherit' }}
                        />
                        <input
                          type="number"
                          value={newItem.qty}
                          min={0}
                          step="any"
                          onChange={e => setNewItem({ ...newItem, qty: e.target.value === '' ? '' : Number(e.target.value) })}
                          style={{ width: 60, border: '1.5px solid #d1d5db', borderRadius: 10, padding: '9px 10px', fontSize: 14, outline: 'none', fontFamily: "'DM Mono',monospace" }}
                        />
                        <input
                          value={newItem.unit}
                          onChange={e => setNewItem({ ...newItem, unit: e.target.value })}
                          placeholder="unit"
                          style={{ width: 70, border: '1.5px solid #d1d5db', borderRadius: 10, padding: '9px 10px', fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button onClick={addItem} style={{ flex: 1, background: '#111827', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 0', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>Add Item</button>
                        <button onClick={() => setShowAddItem(false)} style={{ flex: 1, background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 10, padding: '10px 0', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowAddItem(true)}
                      style={{ width: '100%', background: '#fff', color: '#374151', border: '1.5px dashed #d1d5db', borderRadius: 14, padding: '13px 0', fontWeight: 600, fontSize: 14, cursor: 'pointer', marginBottom: 12, fontFamily: 'inherit' }}
                    >
                      + Add Item
                    </button>
                  )}
                </>
              )}

              {/* ── CROSS-LIST TAB ── */}
              {activeTab === 'missing' && crossData && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Legend */}
                  <div style={{ background: '#fff', borderRadius: 14, padding: '14px 18px', border: '1px solid #e5e7eb', fontSize: 13, color: '#374151', lineHeight: 1.7 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6, color: '#111827' }}>🔍 How this works</div>
                    Scans your unchecked items and compares them across all lists by name. Each unchecked item is classified into one of three groups.
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a' }}>○ Still needed elsewhere</span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>✓ Done in all others</span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, color: '#1e40af', background: '#eff6ff', border: '1px solid #bfdbfe' }}>Only in this list</span>
                    </div>
                  </div>

                  <Section
                    title="⚠️ Also needed in other lists"
                    subtitle="Still unchecked in at least one other list — you still need to buy these."
                    color="#b45309" bg="#fffbeb" border="#fde68a"
                    count={crossData.neededElsewhere.length}
                    expanded={missingExpanded.neededElsewhere}
                    onToggle={() => setMissingExpanded(p => ({ ...p, neededElsewhere: !p.neededElsewhere }))}
                  >
                    {crossData.neededElsewhere.length === 0
                      ? <EmptyNote>No items in this category.</EmptyNote>
                      : crossData.neededElsewhere.map(({ item, matchingOthers }) => (
                          <CrossItem key={item.id} item={item} matches={matchingOthers} onToggle={() => toggleItem(item.id)} />
                        ))}
                  </Section>

                  <Section
                    title="✅ Already done in all other lists"
                    subtitle="Checked off in every other list that has them — consider if you still need them here."
                    color="#166534" bg="#f0fdf4" border="#bbf7d0"
                    count={crossData.coveredElsewhere.length}
                    expanded={missingExpanded.coveredElsewhere}
                    onToggle={() => setMissingExpanded(p => ({ ...p, coveredElsewhere: !p.coveredElsewhere }))}
                  >
                    {crossData.coveredElsewhere.length === 0
                      ? <EmptyNote>No items in this category.</EmptyNote>
                      : crossData.coveredElsewhere.map(({ item, matchingOthers }) => (
                          <CrossItem key={item.id} item={item} matches={matchingOthers} onToggle={() => toggleItem(item.id)} />
                        ))}
                  </Section>

                  <Section
                    title="🔵 Unique to this list"
                    subtitle="These unchecked items don't appear in any other list."
                    color="#1e40af" bg="#eff6ff" border="#bfdbfe"
                    count={crossData.uniqueToThis.length}
                    expanded={missingExpanded.uniqueToThis}
                    onToggle={() => setMissingExpanded(p => ({ ...p, uniqueToThis: !p.uniqueToThis }))}
                  >
                    {crossData.uniqueToThis.length === 0
                      ? <EmptyNote>No items in this category.</EmptyNote>
                      : crossData.uniqueToThis.map(({ item }) => (
                          <CrossItem key={item.id} item={item} matches={[]} onToggle={() => toggleItem(item.id)} />
                        ))}
                  </Section>

                  {/* Summary card */}
                  <div style={{ background: '#111827', borderRadius: 14, padding: '16px 20px', color: '#fff' }}>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>📊 Summary for "{activeList.name}"</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, textAlign: 'center' }}>
                      {[
                        { label: 'Also needed elsewhere', val: crossData.neededElsewhere.length, color: '#fbbf24' },
                        { label: 'Done in all others',    val: crossData.coveredElsewhere.length, color: '#4ade80' },
                        { label: 'Unique to this list',   val: crossData.uniqueToThis.length,    color: '#60a5fa' },
                      ].map(({ label, val, color }) => (
                        <div key={label} style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 10, padding: '10px 6px' }}>
                          <div style={{ fontSize: 24, fontWeight: 700, color }}>{val}</div>
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      <style>{`
        @keyframes fadeSlide { from { opacity:0; transform:translateX(-50%) translateY(-8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        @keyframes pulse { 0%,100% { opacity:.4; } 50% { opacity:1; } }
        * { box-sizing:border-box; }
        button:active { opacity:.8; }
        input:focus { border-color:#111827 !important; box-shadow:0 0 0 2px rgba(17,24,39,0.08); }
      `}</style>
    </div>
  );
}
