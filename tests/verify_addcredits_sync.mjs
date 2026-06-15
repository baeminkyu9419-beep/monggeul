// Real verification harness for addCredits() server-authority atomic-RPC path + race safety.
// Imports the ACTUAL src/services/subscription.js (no paraphrase) and exercises:
//   1) offline RPC failure  -> console.error + pending_sync flag set (DELTA), cache bumped optimistically
//   2) pending_sync retry    -> getCreditsAsync re-applies the pending DELTA via add_credits RPC, flag cleared
//   3) normal online path    -> no console.error, no flag, server credits == before + count (atomic increment)
//   4) RACE (lost-update)    -> two concurrent addCredits from same stale base both accumulate on server
//                               (the bug being fixed: client-side sum+upsert would lose one; atomic RPC must not)
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

// fake supabase modelling the SERVER as the source of truth (db.value).
//   add_credits(p_count) = ATOMIC server-side increment: db.value += p_count; returns new total.
//     This mirrors the SECURITY DEFINER RPC (insert ... on conflict do update set
//     premium_credits = premium_credits + p_count). It does NOT trust any client-sent absolute.
//   offline -> rpc returns {error}; otherwise applies the increment.
//   delay (ms) -> optional await before applying, to model concurrent (interleaved) calls.
const db = { value: null };
function makeSupabase(offline, delay = 0) {
  return {
    from(_table) {
      return {
        // legacy direct-write path is RLS-rejected in prod; harness rejects it too so any
        // regression back to client upsert surfaces as an error (no silent server write).
        async upsert(_row) { return { error: { message: 'user_entitlements direct write rejected (RLS)' } }; },
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: { premium_credits: db.value ?? 0 } }; },
      };
    },
    async rpc(name, args) {
      if (name === 'add_credits') {
        if (offline) return { error: { message: 'simulated network offline' } };
        const n = args?.p_count;
        if (typeof n !== 'number' || n <= 0) return { data: -1, error: null };
        if (delay) await new Promise((r) => setTimeout(r, delay));
        db.value = (db.value ?? 0) + n;   // ATOMIC increment (server authority)
        return { data: db.value, error: null };
      }
      return { data: null, error: { message: 'no rpc in harness: ' + name } };
    },
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
check('offline: pending_sync flag == 1 (delta)',
  localStorage.getItem('mg_credits_pending_sync') === '1',
  `got=${localStorage.getItem('mg_credits_pending_sync')}`);
check('offline: client cache bumped to 1 (optimistic)',
  localStorage.getItem('mg_premium_credits') === '1',
  `got=${localStorage.getItem('mg_premium_credits')}`);
check('offline: server value NOT advanced (still 0)',
  db.value === 0,
  `db.value=${db.value}`);

// ── 2) RECOVERY: new "session" getCreditsAsync flushes pending write ──
store.supabase = makeSupabase(false);  // network back
_errors.length = 0;
await getCreditsAsync();

check('recovery: pending_sync flag cleared',
  localStorage.getItem('mg_credits_pending_sync') === null,
  `got=${localStorage.getItem('mg_credits_pending_sync')}`);
check('recovery: server value synced to 1 (delta re-applied via RPC)',
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
check(`online: server value == ${before + 1} (atomic increment)`,
  db.value === before + 1,
  `before=${before} db.value=${db.value}`);

// ── 4) RACE / LOST-UPDATE: the exact bug being fixed ──
// Two concurrent addCredits(5) + addCredits(3) fired from the SAME stale base.
// OLD code: each read getCredits() (same stale value), computed base+5 / base+3 locally, and
//   upsert-overwrote the row → last write wins → ONE add lost (server ends at base+3 or base+5).
// NEW code: each calls add_credits RPC = server-side atomic increment → BOTH accumulate.
// The fake supabase add_credits applies a delay before incrementing to force interleaving;
// only a true atomic increment survives this. Expected server total = base + 5 + 3.
localStorage.clear();
localStorage.setItem('mg_premium_credits', '10');   // stale local base = 10
const raceBase = 10;
db.value = raceBase;                                  // server also at 10
store.supabase = makeSupabase(false, 15);            // 15ms delay → interleave the two RPCs
_errors.length = 0;

await Promise.all([addCredits(5), addCredits(3)]);    // concurrent, same stale base

check('race: no console.error (both RPCs succeeded)',
  _errors.length === 0,
  `errors=${JSON.stringify(_errors)}`);
check(`race: server total == ${raceBase + 5 + 3} (no lost update)`,
  db.value === raceBase + 5 + 3,
  `expected=${raceBase + 8} db.value=${db.value} — LOST UPDATE if < ${raceBase + 8}`);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
