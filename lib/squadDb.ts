import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface Teammate {
  id: string;
  name: string;
  initials: string;
  lat: number;
  lng: number;
  speed: number;
  status: 'live' | 'check-in' | 'offline';
  lastSeenText: string;
  lastSeenTime: string; // Store as ISO String
  color: string;
  borderColor: string;
  trail: Array<{ lat: number; lng: number }>;
  isSimulated?: boolean;
}

export interface LogEntry {
  id: string;
  time: string;
  type: 'manual' | 'auto';
  lat: number;
  lng: number;
  note: string;
  callsign: string;
}

export interface Squad {
  id: string;
  createdAt: string;
  lastSimulatedTime: string; // Store as ISO String
  members: Teammate[];
  logs: LogEntry[];
}

const DB_FILE_PATH = path.join(os.tmpdir(), 'squads_db.json');

const MAP_BOUNDS = {
  latMax: -23.52,
  latMin: -23.58,
  lngMax: -46.60,
  lngMin: -46.66,
};

const DEFAULT_TEAMMATES = (nowISO: string): Teammate[] => [];

// Helper to read database
async function readDb(): Promise<Record<string, Squad>> {
  try {
    const data = await fs.readFile(DB_FILE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist, return empty record
    return {};
  }
}

// Helper to write database
async function writeDb(db: Record<string, Squad>): Promise<void> {
  await fs.writeFile(DB_FILE_PATH, JSON.stringify(db, null, 2), 'utf8');
}

export async function getSquad(id: string): Promise<Squad | null> {
  const db = await readDb();
  const normalizedId = id.trim().toUpperCase();
  const squad = db[normalizedId];
  if (!squad) return null;

  // Run simulation updates if necessary
  const now = new Date();
  const lastSim = new Date(squad.lastSimulatedTime);
  const diffMs = now.getTime() - lastSim.getTime();

  // Run update if more than 4.5 seconds has passed since last simulation tick
  if (diffMs >= 4500) {
    let updated = false;
    const ticks = Math.min(10, Math.floor(diffMs / 4500)); // Limit catch-up ticks to 10 to avoid performance issues

    for (let t = 0; t < ticks; t++) {
      squad.members = squad.members.map(member => {
        if (!member.isSimulated) {
          // If a real user hasn't synced in 60 seconds, mark as offline
          const lastSeen = new Date(member.lastSeenTime);
          const silenceMs = now.getTime() - lastSeen.getTime();
          if (silenceMs > 60000 && member.status !== 'offline') {
            updated = true;
            return {
              ...member,
              status: 'offline',
              speed: 0,
              lastSeenText: 'Offline'
            };
          }
          return member;
        }

        updated = true;

        if (member.status === 'offline') {
          // 5% chance of reconnecting
          if (Math.random() < 0.05) {
            return {
              ...member,
              status: 'live',
              lastSeenText: 'Live',
              lastSeenTime: now.toISOString(),
              speed: Math.round(Math.random() * 15 + 2)
            };
          }
          return member;
        }

        // Live members move slightly
        let dLat = (Math.random() - 0.5) * 0.0012;
        let dLng = (Math.random() - 0.5) * 0.0012;

        const nextLat = member.lat + dLat;
        const nextLng = member.lng + dLng;

        const updatedLat = nextLat > MAP_BOUNDS.latMax || nextLat < MAP_BOUNDS.latMin ? member.lat - dLat : nextLat;
        const updatedLng = nextLng > MAP_BOUNDS.lngMax || nextLng < MAP_BOUNDS.lngMin ? member.lng - dLng : nextLng;

        const nextSpeed = member.status === 'live'
          ? Math.max(2, Math.min(60, Math.round(member.speed + (Math.random() - 0.5) * 6)))
          : 0;

        const updatedTrail = [...(member.trail || []), { lat: member.lat, lng: member.lng }].slice(-5);

        return {
          ...member,
          lat: updatedLat,
          lng: updatedLng,
          speed: nextSpeed,
          trail: updatedTrail,
          lastSeenTime: now.toISOString(),
          lastSeenText: member.status === 'live' ? 'Live' : member.lastSeenText
        };
      });
    }

    squad.lastSimulatedTime = now.toISOString();
    db[normalizedId] = squad;
    await writeDb(db);
  }

  return squad;
}

export async function createSquad(): Promise<Squad> {
  const db = await readDb();
  
  // Generate a pristine 6-char alphanumeric ID
  let squadId = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  do {
    squadId = '';
    for (let i = 0; i < 6; i++) {
      squadId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (db[squadId]); // Ensure absolute uniqueness

  const nowISO = new Date().toISOString();
  const newSquad: Squad = {
    id: squadId,
    createdAt: nowISO,
    lastSimulatedTime: nowISO,
    members: DEFAULT_TEAMMATES(nowISO),
    logs: [
      {
        id: '1',
        time: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
        type: 'auto',
        lat: -23.547,
        lng: -46.63,
        note: 'Esquadrão tático criado e canal inicializado.',
        callsign: 'HQ'
      }
    ]
  };

  db[squadId] = newSquad;
  await writeDb(db);
  return newSquad;
}

export async function saveSquad(squad: Squad): Promise<void> {
  const db = await readDb();
  db[squad.id.toUpperCase()] = squad;
  await writeDb(db);
}
