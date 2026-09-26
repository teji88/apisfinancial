import type { RetirementScenario, SimulationResult } from "../domain/types";

const DB_NAME = "apis-retirement";
const DB_VERSION = 1;
const SCENARIOS = "scenarios";
const RESULTS = "results";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SCENARIOS)) db.createObjectStore(SCENARIOS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(RESULTS)) db.createObjectStore(RESULTS, { keyPath: "simulationId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface RetirementStore {
  saveScenario(scenario: RetirementScenario): Promise<void>;
  getScenario(id: string): Promise<RetirementScenario | null>;
  listScenarios(): Promise<RetirementScenario[]>;
  saveResult(result: SimulationResult): Promise<void>;
  getResult(id: string): Promise<SimulationResult | null>;
}

export const retirementStore: RetirementStore = {
  async saveScenario(scenario) { const db = await openDb(); await put(db, SCENARIOS, scenario); },
  async getScenario(id) { const db = await openDb(); return (await get(db, SCENARIOS, id)) as RetirementScenario | null; },
  async listScenarios() { const db = await openDb(); return (await all(db, SCENARIOS)) as RetirementScenario[]; },
  async saveResult(result) { const db = await openDb(); await put(db, RESULTS, result); },
  async getResult(id) { const db = await openDb(); return (await get(db, RESULTS, id)) as SimulationResult | null; },
};

function put(db: IDBDatabase, store: string, value: unknown) { return new Promise<void>((resolve, reject) => { const r = db.transaction(store, "readwrite").objectStore(store).put(value); r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error); }); }
function get(db: IDBDatabase, store: string, key: IDBValidKey) { return new Promise<unknown>((resolve, reject) => { const r = db.transaction(store, "readonly").objectStore(store).get(key); r.onsuccess=()=>resolve(r.result ?? null); r.onerror=()=>reject(r.error); }); }
function all(db: IDBDatabase, store: string) { return new Promise<unknown[]>((resolve, reject) => { const r = db.transaction(store, "readonly").objectStore(store).getAll(); r.onsuccess=()=>resolve(r.result ?? []); r.onerror=()=>reject(r.error); }); }
