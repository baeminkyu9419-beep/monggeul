// Real verification harness for addCredits() DB-write-failure handling + pending_sync retry.
// Imports the ACTUAL src/services/subscription.js (no paraphrase) and exercises:
//   1) offline write failure  -> console.error + pending_sync flag set, cache/localStorage still bumped
//   2) pending_sync retry      -> getCreditsAsync flushes pending write on recovery, flag cleared
//   3) normal online path      -> no console.error, no pending_sync flag, DB upsert received +1
// Exit 0 = all assertions pass; exit 1 = any failure.

// ── minimal browser globals (subscription.js -> store.js read localStorage at import) ──
const _ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: (k) => _ls.delete(k),
  clear: () => _ls.clear(),
};
globalThis.document = { getElementById: () => null }; // updateCreditInfo -> el null -> early return
globalThis.window = {};

// capture console.error without losing visibility
const _errors = [];
const _origErr = console.error;
console.error = (...a) => { _errors.push(a.map(String).join(' ')); _origErr(...a); };

const { addCredits, getCreditsAsync, getCredits } = await import('../src/services/subscription.js');
const { store } = await import('../src/store.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`PASS  ${name}`); }
  else { console.log(`FAIL  ${name}  ${detail || ''}`); failures++; }
}

// fake supabase: state.offline -> upsert returns {error}; otherwise applies +write to dbValue
const db = { value: null };
function makeSupabase(offline) {
  return {
    from(_table) {
      return {
        async upsert(row) {
          if (offline) return { error: { message: 'simulated network offline' } };
          db.value = row.premium_credits;
          return { error: null };
        },
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: { premium_credits: db.value ?? 0 } }; },
      };
    },
    async rpc(_name) { return { data: null, error: { message: 'no rpc in harness' } }; },
  };
}

// ── 1) OFFLINE: addCredits(1) must NOT swallow silently ──
localStorage.clear();
localStorage.setItem('mg_premium_credits', '0');
db.value = 0;
store.currentUser = { id: 'user-test-1' };
store.supabase = makeSupabase(true);  // offline
_errors.length = 0;

await addCredits(1);

check('offline: console.error emitted',
  _errors.some((e) => e.includes('addCredits DB write failed')),
  `errors=${JSON.stringify(_errors)}`);
check('offline: pending_sync flag == 1',
  localStorage.getItem('mg_credits_pending_sync') === '1',
  `got=${localStorage.getItem('mg_credits_pending_sync')}`);
check('offline: client cache bumped to 1',
  localStorage.getItem('mg_premium_credits') === '1',
  `got=${localStorage.getItem('mg_premium_credits')}`);
check('offline: DB value NOT advanced (still 0)',
  db.value === 0,
  `db.value=${db.value}`);

// ── 2) RECOVERY: new "session" getCreditsAsync flushes pending write ──
store.supabase = makeSupabase(false);  // network back
_errors.length = 0;
await getCreditsAsync();

check('recovery: pending_sync flag cleared',
  localStorage.getItem('mg_credits_pending_sync') === null,
  `got=${localStorage.getItem('mg_credits_pending_sync')}`);
check('recovery: DB value synced to 1',
  db.value === 1,
  `db.value=${db.value}`);

// ── 3) NORMAL ONLINE path: no error, no flag, DB == getCredits()+1 ──
// (module-level _cachedCredits persists across calls — getCredits() is the real source addCredits reads,
//  so assert against getCredits()+1 rather than a hard-coded localStorage value.)
localStorage.clear();
store.supabase = makeSupabase(false);
_errors.length = 0;
const before = getCredits();
db.value = before;

await addCredits(1);

check('online: no console.error',
  _errors.length === 0,
  `errors=${JSON.stringify(_errors)}`);
check('online: no pending_sync flag',
  localStorage.getItem('mg_credits_pending_sync') === null,
  `got=${localStorage.getItem('mg_credits_pending_sync')}`);
check(`online: DB value == ${before + 1} (getCredits()+1)`,
  db.value === before + 1,
  `before=${before} db.value=${db.value}`);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
