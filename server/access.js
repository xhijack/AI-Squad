// SPDX-License-Identifier: Apache-2.0
// Who may do what (0.14). Every API call needs a role: reads need viewer, work needs member, and the Building's
// configuration, money, secrets, people and legal need the Owner. Owner-only Spaces (floor.json access "owner")
// do not exist for anyone else: their routes answer 404 and they are left out of every list.
import { AsyncLocalStorage } from 'node:async_hooks';
import * as building from './building.js';
import * as floors from './floors.js';
import { roleAtLeast } from './users.js';

// the person behind the current request (history and the Squad Log record it)
export const actorStore = new AsyncLocalStorage();
export const currentActor = () => actorStore.getStore()?.user || null;

const OWNER_ROUTES = [
  /^(PATCH|PUT|POST|DELETE) \/api\/(building|auth\/key|company|backups|users|libraries|roles|voice\/key|squads$|squads\/recommend|independents)/,
  /^PATCH \/api\/(auth|voice|dispatcher|notify|insights)$/,
  /^(PUT|DELETE) \/api\/notify\//,
  /^POST \/api\/notify\/(test)$/,
  /^POST \/api\/insights\//,
  /^GET \/api\/(notify|insights)$/,
  /^(GET|POST) \/api\/nodes$/,
  /^(GET|PATCH) \/api\/erpnext$/,
  /^GET \/api\/legal(\/contract)?$/,
  /^(GET|PATCH) \/api\/tiering$/,
  /^(GET|POST) \/api\/promote(\/preview)?$/,
  /^(PUT|DELETE) \/api\/erpnext\/keys\//,
  /^POST \/api\/erpnext\/(test|sync)$/,
  /^(PATCH|DELETE) \/api\/nodes\/[\w-]+$/,
  /^GET \/api\/(auth|backups|doctor|users)(\/|$)/,
  /^(POST|PATCH|DELETE) \/api\/dispatcher\/queue\//,
  /^POST \/api\/history\/[\w-]+\/rollback$/,
  /^(POST|DELETE) \/api\/floors(\/adopt)?$/,
  /^(PATCH|DELETE) \/api\/floors\/[\w-]+$/,
  /^(PUT|PATCH|POST) \/api\/floors\/[\w-]+\/repos/,
  /^(POST|PATCH|DELETE) \/api\/floors\/[\w-]+\/agents(\/[\w-]+(\/template)?)?$/,
  /^POST \/api\/floors\/[\w-]+\/(blueprint\/update|merge-approval|merges|skills\/install|docs\/approve)$/,
  /^POST \/api\/floors\/[\w-]+\/audits\/[\w-]+\/findings\/F\d+\/apply$/,
  /^POST \/api\/floors\/[\w-]+\/agents\/[\w-]+\/chat\/allow$/,          // allow rules: only the Owner widens permissions
];
// -> 'viewer' | 'member' | 'owner'
export function requiredRole(method, pathname) {
  const key = `${method} ${pathname}`;
  if (OWNER_ROUTES.some((re) => re.test(key))) return 'owner';
  if (method === 'GET' || key === 'POST /api/auth') return 'viewer';
  return 'member';
}
export const allows = (user, need) => !!user && roleAtLeast(user.role, need);

// the Owner-only Spaces (read from floor.json at most every 5 s)
let ownerCache = { at: 0, ids: new Set() };
export function ownerFloors() {
  if (Date.now() - ownerCache.at < 5000) return ownerCache.ids;
  const ids = new Set();
  for (const f of building.loadBuilding().floors) { try { if (floors.readFloor(f.path).floor.access === 'owner') ids.add(f.id); } catch { /* missing */ } }
  ownerCache = { at: Date.now(), ids };
  return ids;
}
export const forgetOwnerFloors = () => { ownerCache.at = 0; };
const isOwner = (user) => user?.role === 'owner';

// a path inside an Owner-only Space, for someone else: hidden (404)
export function hiddenPath(pathname, user) {
  if (isOwner(user)) return false;
  const m = pathname.match(/^\/api\/floors\/([\w-]+)(\/|$)/);
  return !!m && ownerFloors().has(m[1]);
}

// what a list shows to someone who is not the Owner
export function redact(pathname, out, user) {
  if (isOwner(user) || !out || typeof out !== 'object') return out;
  // what only the Owner decides (price approvals, held handoffs, 0.19) is never shown to anyone else
  if (pathname === '/api/building' && Array.isArray(out.attention)) out = { ...out, attention: out.attention.filter((a) => !a.ownerOnly) };
  const hide = ownerFloors();
  if (!hide.size) return out;
  const keep = (x) => !hide.has(x?.floorId) && !hide.has(x?.id);
  if (pathname === '/api/building') return { ...out, floors: out.floors.filter((f) => !hide.has(f.id)), attention: out.attention.filter((a) => !hide.has(a.floorId)) };
  if (pathname === '/api/admin') return { ...out, spaces: out.spaces.filter(keep), agents: out.agents.filter((a) => !hide.has(a.floorId)), history: out.history.filter((h) => !hide.has(h.floorId)) };
  if (pathname === '/api/history') return { ...out, changes: out.changes.filter((h) => !hide.has(h.floorId)) };
  if (pathname === '/api/jobs') return { ...out, jobs: out.jobs.filter((j) => !hide.has(j.floorId)) };
  if (pathname === '/api/dispatcher') return { ...out, queue: out.queue.filter((q) => !hide.has(q.floorId)) };
  if (/^\/api\/(history|jobs)\/[\w-]+$/.test(pathname) && hide.has(out.floorId)) return null;
  return out;
}
