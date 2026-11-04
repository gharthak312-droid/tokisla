// Mock `node-appwrite` SDK for tests/functions.merged-actions.test.mjs.
// Plain Node, no dependencies, no network. The stub reads its state from
// the shared module-level object exported below, so the test can reset
// and seed it between cases. It implements ONLY the SDK surface the
// merged `api` handler uses (Client/Account/TablesDB/Storage/Teams/
// Users, ID/Permission/Query/Role). Query strings use the same JSON
// shapes the real Web SDK 29.2.0 produces, so the handler's
// Query.equal/limit/offset parsing in listRows works unchanged.
// This stub must never be used outside tests: it is not the SDK.

function notFound(message = "Row not found.") {
  const e = new Error(message);
  e.code = 404;
  return e;
}

export const mockState = {
  callerId: "u-1",
  authFail: false,
  tables: new Map(),
  files: new Map(),
  memberships: [],
  ops: [],
  seq: 0,
  failDeleteFileIds: new Set(),
  authDeleted: null,
  teamRemoved: [],
};

export function resetMock({ callerId = "u-1" } = {}) {
  mockState.callerId = callerId;
  mockState.authFail = false;
  mockState.tables = new Map();
  mockState.files = new Map();
  mockState.memberships = [];
  mockState.ops = [];
  mockState.seq = 0;
  mockState.failDeleteFileIds = new Set();
  mockState.authDeleted = null;
  mockState.teamRemoved = [];
}

export function seedRow(table, rowId, data) {
  if (!mockState.tables.has(table)) mockState.tables.set(table, new Map());
  const row = { $id: rowId, ...data };
  mockState.tables.get(table).set(rowId, row);
  return row;
}

export function seedFile(fileId, fields = {}) {
  const file = { $id: fileId, name: `${fileId}.mp4`, sizeOriginal: 100, $permissions: [], ...fields };
  mockState.files.set(fileId, file);
  return file;
}

export function tableRows(table) {
  return [...(mockState.tables.get(table) || new Map()).values()];
}

export function getRow(table, rowId) {
  return (mockState.tables.get(table) || new Map()).get(rowId) || null;
}

export class Client {
  setEndpoint() { return this; }
  setProject() { return this; }
  setKey() { return this; }
  setJWT(jwt) { this._jwt = jwt; return this; }
}

export class Account {
  constructor(client) { this._client = client; }
  async get() {
    if (mockState.authFail || !this._client || !this._client._jwt) {
      const e = new Error("Not signed in.");
      e.code = 401;
      throw e;
    }
    return { $id: mockState.callerId };
  }
}

function parseQueries(queries = []) {
  let equal = [];
  let limit = null;
  let offset = 0;
  for (const q of queries) {
    let parsed = q;
    if (typeof q === "string") {
      try { parsed = JSON.parse(q); } catch { continue; }
    }
    if (!parsed || typeof parsed !== "object") continue;
    if (parsed.method === "equal") equal.push(parsed);
    else if (parsed.method === "limit") limit = Number(parsed.values[0]);
    else if (parsed.method === "offset") offset = Number(parsed.values[0]);
  }
  return { equal, limit, offset };
}

function matches(row, equal) {
  return equal.every((q) => {
    const values = Array.isArray(q.values) ? q.values : [q.values];
    return values.some((v) => String(row[q.attribute]) === String(v));
  });
}

export class TablesDB {
  constructor(_client) {}
  async getRow({ tableId, rowId }) {
    mockState.ops.push(`getRow:${tableId}:${rowId}`);
    const row = getRow(tableId, rowId);
    if (!row) throw notFound();
    return { ...row };
  }
  async listRows({ tableId, queries }) {
    mockState.ops.push(`listRows:${tableId}`);
    const { equal, limit, offset } = parseQueries(queries);
    const all = tableRows(tableId).filter((r) => matches(r, equal));
    const sliced = limit === null ? all.slice(offset) : all.slice(offset, offset + limit);
    return { rows: sliced.map((r) => ({ ...r })), total: all.length };
  }
  async createRow({ tableId, rowId, data, permissions }) {
    mockState.ops.push(`createRow:${tableId}:${rowId}`);
    const row = { $id: rowId, $permissions: permissions || [], ...JSON.parse(JSON.stringify(data || {})) };
    seedRow(tableId, rowId, row);
    // seedRow re-spreads $id; keep the stored copy as the return value.
    return { ...getRow(tableId, rowId) };
  }
  async updateRow({ tableId, rowId, data, permissions }) {
    mockState.ops.push(`updateRow:${tableId}:${rowId}`);
    const cur = getRow(tableId, rowId);
    if (!cur) throw notFound();
    const next = { ...cur, ...JSON.parse(JSON.stringify(data || {})) };
    if (permissions) next.$permissions = permissions;
    mockState.tables.get(tableId).set(rowId, next);
    return { ...next };
  }
  async deleteRow({ tableId, rowId }) {
    mockState.ops.push(`deleteRow:${tableId}:${rowId}`);
    const table = mockState.tables.get(tableId);
    if (!table || !table.has(rowId)) throw notFound();
    table.delete(rowId);
    return {};
  }
}

export class Storage {
  constructor(_client) {}
  async getFile({ fileId }) {
    mockState.ops.push(`getFile:${fileId}`);
    const file = mockState.files.get(fileId);
    if (!file) throw notFound("File not found.");
    return { ...file, $permissions: [...(file.$permissions || [])] };
  }
  async deleteFile({ fileId }) {
    mockState.ops.push(`deleteFile:${fileId}`);
    if (mockState.failDeleteFileIds.has(fileId)) throw new Error(`delete failed for ${fileId}`);
    if (!mockState.files.has(fileId)) throw notFound("File not found.");
    mockState.files.delete(fileId);
    return {};
  }
  async updateFile({ fileId, name, permissions }) {
    mockState.ops.push(`updateFile:${fileId}`);
    const file = mockState.files.get(fileId);
    if (!file) throw notFound("File not found.");
    const next = { ...file, name, $permissions: permissions || file.$permissions };
    mockState.files.set(fileId, next);
    return { ...next };
  }
}

export class Teams {
  constructor(_client) {}
  async listMemberships() {
    mockState.ops.push("listMemberships:admins");
    return { memberships: mockState.memberships.map((m) => ({ ...m })) };
  }
  async deleteMembership({ membershipId }) {
    mockState.ops.push(`deleteMembership:${membershipId}`);
    mockState.teamRemoved.push(membershipId);
    mockState.memberships = mockState.memberships.filter((m) => m.$id !== membershipId);
    return {};
  }
}

export class Users {
  constructor(_client) {}
  async delete({ userId }) {
    mockState.ops.push(`users.delete:${userId}`);
    mockState.authDeleted = userId;
    return {};
  }
}

let idSeq = 0;
export const ID = {
  unique: () => `mock-id-${++idSeq}`,
  custom: (id) => id,
};
export function resetIdSeq() { idSeq = 0; }

export const Permission = {
  read: (role) => `read("${role}")`,
  update: (role) => `update("${role}")`,
  delete: (role) => `delete("${role}")`,
};

export const Role = {
  any: () => "any",
  user: (id) => `user:${id}`,
  team: (id) => `team:${id}`,
};

const q = (method, attribute, values) => JSON.stringify({ method, attribute, values });
export const Query = {
  equal: (attribute, values) => q("equal", attribute, Array.isArray(values) ? values : [values]),
  notEqual: (attribute, values) => q("notEqual", attribute, Array.isArray(values) ? values : [values]),
  limit: (value) => q("limit", undefined, [value]),
  offset: (value) => q("offset", undefined, [value]),
  orderAsc: (attribute) => q("orderAsc", attribute, []),
  orderDesc: (attribute) => q("orderDesc", attribute, []),
  search: (attribute, value) => q("search", attribute, [value]),
  greaterThan: (attribute, value) => q("greaterThan", attribute, [value]),
  lessThan: (attribute, value) => q("lessThan", attribute, [value]),
};
