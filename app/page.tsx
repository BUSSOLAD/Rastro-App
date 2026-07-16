'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  MapPin,
  Compass,
  RotateCw,
  Bell,
  ArrowRight,
  Terminal,
  Settings as SettingsIcon,
  Plus,
  Minus,
  Info,
  Users,
  History,
  Radio,
  ChevronDown,
  ChevronUp,
  LogOut,
  Check,
  Map as MapIcon,
  Send,
  Sliders,
  CheckSquare,
  AlertTriangle,
  Copy
} from 'lucide-react';

// ============================================================================
// Types & Interfaces
// ============================================================================
interface Teammate {
  id: string;
  name: string;
  initials: string;
  lat: number;
  lng: number;
  speed: number;
  status: 'live' | 'check-in' | 'offline';
  lastSeenText: string;
  lastSeenTime: Date;
  color: string;
  borderColor: string;
  trail: Array<{ lat: number; lng: number }>;
}

interface LogEntry {
  id: string;
  time: string;
  type: 'manual' | 'auto';
  lat: number;
  lng: number;
  note: string;
  callsign: string;
}

// ============================================================================
// Constants & Helper Functions
// ============================================================================
// São Paulo Bounding Box for click coordinates translation
const MAP_BOUNDS = {
  latMax: -23.52,
  latMin: -23.58,
  lngMax: -46.60,
  lngMin: -46.66,
};

// Haversine formula to calculate real distance in km
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Earth radius in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  const brng = Math.atan2(y, x) * 180 / Math.PI;
  return Math.round((brng + 360) % 360);
}

let lastCoordsRef: [number, number][] | null = null;
let lastDistances: number[] = [];
let lastTotalDist = 0;

function getPointAlongPath(coords: [number, number][], ratio: number): { lat: number; lng: number } {
  if (!coords || coords.length === 0) return { lat: 0, lng: 0 };
  if (coords.length === 1) return { lat: coords[0][1], lng: coords[0][0] };
  if (ratio <= 0) return { lat: coords[0][1], lng: coords[0][0] };
  if (ratio >= 1) return { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] };

  let distances: number[];
  let totalDist = 0;

  if (coords === lastCoordsRef) {
    distances = lastDistances;
    totalDist = lastTotalDist;
  } else {
    distances = [0];
    for (let i = 0; i < coords.length - 1; i++) {
      const d = getDistanceKm(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
      totalDist += d;
      distances.push(totalDist);
    }
    lastCoordsRef = coords;
    lastDistances = distances;
    lastTotalDist = totalDist;
  }

  if (totalDist === 0) {
    return { lat: coords[0][1], lng: coords[0][0] };
  }

  const targetDist = ratio * totalDist;

  let low = 0;
  let high = distances.length - 1;
  let segmentIndex = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (distances[mid] <= targetDist) {
      segmentIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (segmentIndex >= coords.length - 1) {
    return { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] };
  }

  const p1 = coords[segmentIndex];
  const p2 = coords[segmentIndex + 1];
  const dist1 = distances[segmentIndex];
  const dist2 = distances[segmentIndex + 1];

  const segmentLength = dist2 - dist1;
  const segmentRatio = segmentLength > 0 ? (targetDist - dist1) / segmentLength : 0;

  return {
    lat: p1[1] + (p2[1] - p1[1]) * segmentRatio,
    lng: p1[0] + (p2[0] - p1[0]) * segmentRatio,
  };
}

// Helper to extract hex color from class name like "text-[#00ff41]" or "border-[#dfd8ff]"
function getHexColor(colorClass: string, defaultColor: string = '#00ff41'): string {
  const match = colorClass.match(/#([0-9a-fA-F]{3,8})/);
  return match ? `#${match[1]}` : defaultColor;
}

function getSegmentKey(profile: string, lng1: number, lat1: number, lng2: number, lat2: number): string {
  return `rastro_seg_${profile}_${lng1.toFixed(5)},${lat1.toFixed(5)}_${lng2.toFixed(5)},${lat2.toFixed(5)}`;
}

async function fetchRouteSegment(profile: string, lng1: number, lat1: number, lng2: number, lat2: number): Promise<[number, number][]> {
  const cacheKey = getSegmentKey(profile, lng1, lat1, lng2, lat2);
  
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    console.error('Failed to read from localStorage cache:', e);
  }

  const fallbackCoords: [number, number][] = [
    [lng1, lat1],
    [lng2, lat2]
  ];

  const dist = getDistanceKm(lat1, lng1, lat2, lng2);
  if (dist < 0.003) { // Less than 3 meters, treat as same spot
    return fallbackCoords;
  }

  const url = `https://router.project-osrm.org/route/v1/${profile}/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`OSRM HTTP error: ${response.status}`);
    }
    const data = await response.json();
    if (data.code === 'Ok' && data.routes && data.routes[0]?.geometry?.coordinates) {
      const coords = data.routes[0].geometry.coordinates as [number, number][];
      if (coords && coords.length > 0) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify(coords));
        } catch (e) {
          console.warn('LocalStorage write error:', e);
        }
        return coords;
      }
    }
  } catch (err) {
    console.warn(`OSRM routing failed: ${lng1},${lat1} -> ${lng2},${lat2}. Fallback to line.`, err);
  }

  return fallbackCoords;
}

async function getRoutedTrail(profile: string, points: { lat: number; lng: number }[]): Promise<[number, number][]> {
  if (!points || points.length < 2) return [];

  const fullCoords: [number, number][] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const segment = await fetchRouteSegment(profile, p1.lng, p1.lat, p2.lng, p2.lat);
    
    if (fullCoords.length > 0) {
      fullCoords.push(...segment.slice(1));
    } else {
      fullCoords.push(...segment);
    }
  }

  return fullCoords;
}

// Converts coordinates to percentage positions for the static map background
function coordsToPct(lat: number, lng: number) {
  const { latMax, latMin, lngMax, lngMin } = MAP_BOUNDS;
  const left = ((lng - lngMin) / (lngMax - lngMin)) * 100;
  const top = ((latMax - lat) / (latMax - latMin)) * 100;
  return {
    left: Math.max(0, Math.min(100, left)),
    top: Math.max(0, Math.min(100, top)),
  };
}

// Converts percentage positions on the map to coordinates
function pctToCoords(leftPct: number, topPct: number) {
  const { latMax, latMin, lngMax, lngMin } = MAP_BOUNDS;
  const lng = lngMin + (leftPct / 100) * (lngMax - lngMin);
  const lat = latMax - (topPct / 100) * (latMax - latMin);
  return { lat, lng };
}

// Color spectrum configurations for the user's marker
const COLOR_SPECTRUM = [
  { id: 'primary', hex: '#00ff41', name: 'Signal Green', textClass: 'text-[#00ff41]', borderClass: 'border-[#00ff41]', bgClass: 'bg-[#00ff41]/20 shadow-[0_0_15px_#00ff41]' },
  { id: 'cyan', hex: '#00e5ff', name: 'Cyber Cyan', textClass: 'text-[#00e5ff]', borderClass: 'border-[#00e5ff]', bgClass: 'bg-[#00e5ff]/20 shadow-[0_0_15px_#00e5ff]' },
  { id: 'blue', hex: '#2979ff', name: 'Pulse Blue', textClass: 'text-[#2979ff]', borderClass: 'border-[#2979ff]', bgClass: 'bg-[#2979ff]/20 shadow-[0_0_15px_#2979ff]' },
  { id: 'purple', hex: '#d500f9', name: 'Neon Purple', textClass: 'text-[#d500f9]', borderClass: 'border-[#d500f9]', bgClass: 'bg-[#d500f9]/20 shadow-[0_0_15px_#d500f9]' },
  { id: 'pink', hex: '#f50057', name: 'Laser Pink', textClass: 'text-[#f50057]', borderClass: 'border-[#f50057]', bgClass: 'bg-[#f50057]/20 shadow-[0_0_15px_#f50057]' },
  { id: 'orange', hex: '#ff9100', name: 'Warm Orange', textClass: 'text-secondary', borderClass: 'border-secondary', bgClass: 'bg-secondary/20 shadow-[0_0_15px_#ffb77d]' },
  { id: 'yellow', hex: '#ffea00', name: 'Tactical Yellow', textClass: 'text-[#ffea00]', borderClass: 'border-[#ffea00]', bgClass: 'bg-[#ffea00]/20 shadow-[0_0_15px_#ffea00]' },
  { id: 'white', hex: '#e5e2e1', name: 'Stealth White', textClass: 'text-[#e5e2e1]', borderClass: 'border-[#e5e2e1]', bgClass: 'bg-[#e5e2e1]/10 shadow-[0_0_15px_#e5e2e1]' },
];

if (typeof window !== 'undefined') {
  // Override console.error and console.warn to capture and suppress Google Maps specific messages
  const originalConsoleError = console.error;
  console.error = function (...args: any[]) {
    const msg = args.map(arg => {
      if (arg && typeof arg === 'object') {
        return arg.message || JSON.stringify(arg);
      }
      return String(arg);
    }).join(' ');

    if (
      msg.includes('Google Maps') || 
      msg.includes('InvalidKeyMapError') || 
      msg.includes('gm_authFailure') ||
      msg.includes('maps.googleapis.com') ||
      msg.includes('Script error.')
    ) {
      console.info('[Google Maps Suppressed Console Error]:', ...args);
      (window as any).gm_auth_failed_triggered = true;
      window.dispatchEvent(new CustomEvent('gm_auth_failed'));
      return;
    }
    originalConsoleError.apply(console, args);
  };

  const originalConsoleWarn = console.warn;
  console.warn = function (...args: any[]) {
    const msg = args.map(arg => {
      if (arg && typeof arg === 'object') {
        return arg.message || JSON.stringify(arg);
      }
      return String(arg);
    }).join(' ');

    if (
      msg.includes('Google Maps') || 
      msg.includes('InvalidKeyMapError') || 
      msg.includes('gm_authFailure') ||
      msg.includes('maps.googleapis.com') ||
      msg.includes('Script error.')
    ) {
      console.info('[Google Maps Suppressed Console Warning]:', ...args);
      (window as any).gm_auth_failed_triggered = true;
      window.dispatchEvent(new CustomEvent('gm_auth_failed'));
      return;
    }
    originalConsoleWarn.apply(console, args);
  };

  // Set gm_authFailure immediately
  (window as any).gm_authFailure = () => {
    console.warn('Google Maps API authentication failed.');
    (window as any).gm_auth_failed_triggered = true;
    window.dispatchEvent(new CustomEvent('gm_auth_failed'));
  };

  // Intercept and swallow uncaught script errors and Google Maps specific failures
  const originalOnError = window.onerror;
  window.onerror = function (message, source, lineno, colno, error) {
    const msg = String(message || '');
    const src = String(source || '');
    
    const isGoogleMapsError = 
      msg.includes('Google Maps') || 
      msg.includes('InvalidKeyMapError') || 
      msg.includes('gm_authFailure') ||
      src.includes('maps.googleapis.com') ||
      msg === 'Script error.'; // Google Maps cross-origin script loads trigger 'Script error.' on failure

    if (isGoogleMapsError) {
      console.info('[Google Maps Suppressed Global Error]:', msg, src);
      (window as any).gm_auth_failed_triggered = true;
      window.dispatchEvent(new CustomEvent('gm_auth_failed'));
      // Return true to prevent the default browser error handler and quiet down 'Script error.'
      return true;
    }

    if (originalOnError) {
      return originalOnError.apply(window, [message, source, lineno, colno, error]);
    }
    return false;
  };

  // Intercept and swallow unhandled promise rejections from maps
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || '';
    if (
      reason.includes('Google Maps') || 
      reason.includes('InvalidKeyMapError') || 
      reason.includes('maps.googleapis.com')
    ) {
      console.info('[Google Maps Suppressed Global Rejection]:', reason);
      (window as any).gm_auth_failed_triggered = true;
      window.dispatchEvent(new CustomEvent('gm_auth_failed'));
      event.preventDefault();
    }
  });
}

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

// Dark tactical map style matching Rastro's cyberpunk vibe
const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#131313' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#131313' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#84967e' }] },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#00ff41' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#84967e' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#1b261b' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#5b6b55' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#1c1b1b' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#2a2a2a' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#84967e' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#353534' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#201f1f' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#00ff41' }],
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#201f1f' }],
  },
  {
    featureType: 'transit.station',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#00ff41' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#0e0e0e' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#3b4b37' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#0e0e0e' }],
  },
];

// ============================================================================
// MapLibre GL JS Helpers and Component
// ============================================================================

function renderUserMarkerHTML(container: HTMLElement, activeColorTheme: any, callsign: string, userCoords: any, useGPSReal: boolean) {
  container.innerHTML = `
    <!-- Data Tag hover info -->
    <div class="absolute bottom-full mb-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50 pointer-events-none">
      <div class="glass-panel rounded-lg px-2 py-1 flex items-center gap-1.5 font-mono text-[10px] text-[#e5e2e1] whitespace-nowrap bg-[#131313]/90 border border-white/10 shadow-lg">
        <span>${userCoords.speed} km/h</span>
        <div class="w-[1px] h-3 bg-white/20"></div>
        <span>${useGPSReal ? 'GPS' : 'SIM'}</span>
      </div>
    </div>

    <!-- Pulsing Glow behind Marker -->
    <div class="absolute inset-x-0 bottom-4 mx-auto rounded-full ${activeColorTheme.bgClass} blur-md -z-10 scale-[1.7] w-10 h-10"></div>

    <!-- Marker Badge -->
    <div class="w-10 h-10 rounded-full border-2 ${activeColorTheme.borderClass} bg-[#1a1a1a] flex items-center justify-center shadow-lg relative z-10 transition-transform duration-300">
      <span class="font-mono text-xs font-black ${activeColorTheme.textClass}">
        ${callsign.slice(0, 2).toUpperCase()}
      </span>
    </div>

    <!-- Label -->
    <span class="mt-1 font-mono text-[10px] font-bold drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] ${activeColorTheme.textClass}">
      Você
    </span>
  `;
}

function createUserMarkerElement(activeColorTheme: any, callsign: string, userCoords: any, useGPSReal: boolean, onClick: () => void) {
  const container = document.createElement('div');
  container.className = 'relative flex flex-col items-center cursor-pointer w-24 h-24 justify-end group';
  
  container.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };

  renderUserMarkerHTML(container, activeColorTheme, callsign, userCoords, useGPSReal);
  return container;
}

function updateUserMarkerElement(container: HTMLElement, activeColorTheme: any, callsign: string, userCoords: any, useGPSReal: boolean) {
  renderUserMarkerHTML(container, activeColorTheme, callsign, userCoords, useGPSReal);
}

function renderTeammateMarkerHTML(container: HTMLElement, member: Teammate, distance: number, isFocused: boolean) {
  container.innerHTML = `
    <!-- Live Telemetry Tag -->
    <div class="absolute bottom-full mb-1 transition-all duration-200 ${isFocused ? 'opacity-100 scale-100' : 'opacity-0 scale-95 group-hover:opacity-100'} z-50 pointer-events-none">
      <div class="glass-panel rounded-lg px-2 py-1 flex items-center gap-1.5 font-mono text-[9px] text-[#e5e2e1] whitespace-nowrap bg-[#131313]/90 border border-white/10 shadow-lg">
        <span class="text-[#00ff41] font-bold">${distance.toFixed(1)} km</span>
        <div class="w-[1px] h-3 bg-white/20"></div>
        <span>${member.speed} km/h</span>
      </div>
    </div>

    <!-- Ring Pulse for live statuses -->
    ${member.status === 'live' ? `
      <div class="absolute inset-x-0 bottom-4 mx-auto rounded-full bg-[#00ff41]/10 blur-sm pulse-green w-8 h-8"></div>
    ` : ''}

    <!-- Teammate Icon Badge -->
    <div class="w-8 h-8 rounded-full border-2 ${isFocused ? 'border-[#00e5ff] scale-110' : member.borderColor} bg-[#1a1a1a] flex items-center justify-center shadow-lg relative z-10 transition-transform duration-300">
      <span class="font-mono text-[10px] font-bold text-white">
        ${member.initials}
      </span>
      ${member.status === 'live' ? `
        <div class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#00ff41] border border-[#1a1a1a] pulse-green"></div>
      ` : ''}
    </div>

    <!-- Label -->
    <span class="mt-1 font-mono text-[9px] font-bold drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] whitespace-nowrap ${isFocused ? 'text-[#00e5ff]' : 'text-gray-400'}">
      ${member.name}
    </span>
  `;
}

function createTeammateMarkerElement(member: Teammate, distance: number, isFocused: boolean, onClick: () => void) {
  const container = document.createElement('div');
  container.className = 'relative flex flex-col items-center cursor-pointer w-20 h-20 justify-end group';
  container.style.opacity = member.status === 'offline' ? '0.5' : '1';
  
  container.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };

  renderTeammateMarkerHTML(container, member, distance, isFocused);
  return container;
}

function updateTeammateMarkerElement(container: HTMLElement, member: Teammate, distance: number, isFocused: boolean) {
  container.style.opacity = member.status === 'offline' ? '0.5' : '1';
  renderTeammateMarkerHTML(container, member, distance, isFocused);
}

function updateSquadLines(
  map: any, 
  userCoords: any, 
  userTrail: { lat: number; lng: number }[],
  teammates: Teammate[], 
  selectedTeammate: string | null,
  routedTrails: { [memberId: string]: [number, number][] },
  activeColorTheme: any,
  showTrail: boolean
) {
  if (!map || !map.isStyleLoaded()) return;

  const activeSourceIds = new Set<string>();

  // 0. User's own historical trail
  const userTrailCoords = showTrail ? (userTrail || []).map(p => [p.lng, p.lat]) : [];
  if (userTrailCoords.length >= 2) {
    const trailSourceId = 'trail-source-user';
    const trailLayerId = 'trail-layer-user';
    activeSourceIds.add(trailSourceId);

    const geojson = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: userTrailCoords
      }
    };

    const userHexColor = getHexColor(activeColorTheme?.textClass || 'text-[#00ff41]', '#00ff41');

    if (!map.getSource(trailSourceId)) {
      map.addSource(trailSourceId, {
        type: 'geojson',
        data: geojson
      });
      map.addLayer({
        id: trailLayerId,
        type: 'line',
        source: trailSourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': userHexColor,
          'line-width': 4.5,
          'line-opacity': 0.8
        }
      });
    } else {
      const src = map.getSource(trailSourceId);
      if (src) src.setData(geojson);
      map.setPaintProperty(trailLayerId, 'line-color', userHexColor);
    }
  }

  teammates.forEach(member => {
    if (member.status === 'offline') return;

    const isFocused = selectedTeammate === member.id;
    const trailCoords = routedTrails[member.id];
    
    // 1. Historical Trail
    if (showTrail && trailCoords && trailCoords.length > 0) {
      const trailSourceId = `trail-source-${member.id}`;
      const trailLayerId = `trail-layer-${member.id}`;
      activeSourceIds.add(trailSourceId);

      const geojson = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: trailCoords
        }
      };

      const memberHexColor = getHexColor(member.color, '#00ff41');

      if (!map.getSource(trailSourceId)) {
        map.addSource(trailSourceId, {
          type: 'geojson',
          data: geojson
        });
        map.addLayer({
          id: trailLayerId,
          type: 'line',
          source: trailSourceId,
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': memberHexColor,
            'line-width': 4,
            'line-opacity': 0.6
          }
        });
      } else {
        const src = map.getSource(trailSourceId);
        if (src) src.setData(geojson);
        map.setPaintProperty(trailLayerId, 'line-color', memberHexColor);
      }
    }
  });

  // Cleanup old layers and sources
  const style = map.getStyle();
  if (style && style.layers) {
    style.layers.forEach((layer: any) => {
      if (layer.id.startsWith('trail-layer-') || layer.id.startsWith('link-layer-')) {
        const sourceId = layer.source;
        if (!activeSourceIds.has(sourceId)) {
          if (map.getLayer(layer.id)) map.removeLayer(layer.id);
          if (map.getSource(sourceId)) map.removeSource(sourceId);
        }
      }
    });
  }
}

interface MapLibreMapProps {
  userCoords: { lat: number; lng: number; speed: number; heading: number };
  userTrail: { lat: number; lng: number }[];
  teammates: Teammate[];
  selectedTeammate: string | null;
  setSelectedTeammate: React.Dispatch<React.SetStateAction<string | null>>;
  activeColorTheme: any;
  callsign: string;
  useGPSReal: boolean;
  setUseGPSReal: React.Dispatch<React.SetStateAction<boolean>>;
  triggerNotification: (message: string, type: 'success' | 'alert' | 'info') => void;
  routeProfile: 'driving' | 'foot';
  onMapClick?: (lat: number, lng: number) => void;
  showTrail: boolean;
}

function MapLibreMap({
  userCoords,
  userTrail,
  teammates,
  selectedTeammate,
  setSelectedTeammate,
  activeColorTheme,
  callsign,
  useGPSReal,
  setUseGPSReal,
  triggerNotification,
  routeProfile,
  onMapClick,
  showTrail,
}: MapLibreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<{ [id: string]: any }>({});
  const [routedTrails, setRoutedTrails] = useState<{ [memberId: string]: [number, number][] }>({});

  const onMapClickRef = useRef<any>(onMapClick);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    let active = true;

    const computeAllTrails = async () => {
      const newTrails: { [id: string]: [number, number][] } = {};
      
      for (const member of teammates) {
        if (member.status === 'offline') continue;
        const rawPoints = member.trail && member.trail.length > 0 
          ? [...member.trail, { lat: member.lat, lng: member.lng }]
          : [];
        
        if (rawPoints.length >= 2) {
          const coords = await getRoutedTrail(routeProfile, rawPoints);
          newTrails[member.id] = coords;
        }
      }

      if (active) {
        setRoutedTrails(newTrails);
      }
    };

    computeAllTrails();

    return () => {
      active = false;
    };
  }, [teammates, routeProfile]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const maplibregl = (window as any).maplibregl;
    if (!maplibregl) {
      console.warn('MapLibre GL JS script is not loaded yet.');
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [userCoords.lng, userCoords.lat],
      zoom: 13,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on('click', (e: any) => {
      const { lng, lat } = e.lngLat;
      if (onMapClickRef.current) {
        onMapClickRef.current(lat, lng);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (selectedTeammate) {
      const teammate = teammates.find(t => t.id === selectedTeammate);
      if (teammate) {
        map.easeTo({ center: [teammate.lng, teammate.lat] });
      }
    } else {
      map.easeTo({ center: [userCoords.lng, userCoords.lat] });
    }
  }, [selectedTeammate, userCoords.lat, userCoords.lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (typeof window === 'undefined' || !map) return;
    const maplibregl = (window as any).maplibregl;
    if (!maplibregl) return;

    // User Marker
    if (!markersRef.current['user']) {
      const el = createUserMarkerElement(activeColorTheme, callsign, userCoords, useGPSReal, () => {
        setSelectedTeammate(null);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([userCoords.lng, userCoords.lat])
        .addTo(map);
      markersRef.current['user'] = marker;
    } else {
      markersRef.current['user'].setLngLat([userCoords.lng, userCoords.lat]);
      const el = markersRef.current['user'].getElement();
      updateUserMarkerElement(el, activeColorTheme, callsign, userCoords, useGPSReal);
    }

    // Teammates Markers
    const currentIds = new Set(teammates.map(t => t.id));

    Object.keys(markersRef.current).forEach(id => {
      if (id !== 'user' && !currentIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });

    teammates.forEach(member => {
      const distance = getDistanceKm(userCoords.lat, userCoords.lng, member.lat, member.lng);
      const isFocused = selectedTeammate === member.id;

      if (!markersRef.current[member.id]) {
        const el = createTeammateMarkerElement(member, distance, isFocused, () => {
          setSelectedTeammate(prev => prev === member.id ? null : member.id);
        });
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([member.lng, member.lat])
          .addTo(map);
        markersRef.current[member.id] = marker;
      } else {
        markersRef.current[member.id].setLngLat([member.lng, member.lat]);
        const el = markersRef.current[member.id].getElement();
        updateTeammateMarkerElement(el, member, distance, isFocused);
      }
    });
  }, [teammates, userCoords, selectedTeammate, activeColorTheme, callsign, useGPSReal]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!map.isStyleLoaded()) {
      const handleStyleLoad = () => {
        updateSquadLines(map, userCoords, userTrail, teammates, selectedTeammate, routedTrails, activeColorTheme, showTrail);
      };
      map.once('style.load', handleStyleLoad);
      return () => {
        map.off('style.load', handleStyleLoad);
      };
    } else {
      updateSquadLines(map, userCoords, userTrail, teammates, selectedTeammate, routedTrails, activeColorTheme, showTrail);
    }
  }, [teammates, userCoords, userTrail, selectedTeammate, routedTrails, activeColorTheme, showTrail]);

  return (
    <div className="w-full h-full relative">
      <style>{`
        @keyframes pulse-green-glow {
          0%, 100% {
            transform: scale(1);
            opacity: 0.15;
          }
          50% {
            transform: scale(1.6);
            opacity: 0.45;
          }
        }
        .pulse-green {
          animation: pulse-green-glow 2s infinite ease-in-out;
        }
      `}</style>
      <div ref={containerRef} className="w-full h-full absolute inset-0 bg-[#131313]" />
    </div>
  );
}

export default function RastroApp() {
  // ============================================================================
  // App Navigation & Basic Settings States
  // ============================================================================
  const [screen, setScreen] = useState<'onboarding' | 'squad-setup' | 'map' | 'settings'>('onboarding');
  const [locationGranted, setLocationGranted] = useState(false);
  const [showLocationHelpModal, setShowLocationHelpModal] = useState(false);
  const [activeHelpTab, setActiveHelpTab] = useState<'apk' | 'android' | 'ios'>(() => {
    if (typeof window === 'undefined') return 'apk';
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isAndroid = /Android/.test(ua);
    const isWebView = (window as any).Capacitor || (window as any).cordova || /wv/i.test(ua) || (isAndroid && /Version\/[0-9.]+/i.test(ua)) || (isIOS && !/Safari/i.test(ua));
    if (isWebView) return 'apk';
    if (isIOS) return 'ios';
    return 'android';
  });
  const [notificationsGranted, setNotificationsGranted] = useState(false);
  const [callsign, setCallsign] = useState('OPERADOR');
  const [markerColor, setMarkerColor] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('rastro_marker_color') || 'primary';
    }
    return 'primary';
  });
  const [checkInInterval, setCheckInInterval] = useState('15');
  const [silentMode, setSilentMode] = useState(false);
  const [routeProfile, setRouteProfile] = useState<'driving' | 'foot'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('rastro_route_profile') as 'driving' | 'foot') || 'driving';
    }
    return 'driving';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('rastro_route_profile', routeProfile);
    }
  }, [routeProfile]);

  // Squad Navigation & Telemetry states
  const [squadId, setSquadId] = useState('');
  const [squadInput, setSquadInput] = useState('');
  const [squadError, setSquadError] = useState('');
  const [isNewSquad, setIsNewSquad] = useState(false);
  const [showIdentityStep, setShowIdentityStep] = useState(false);
  const [isLoadingSquad, setIsLoadingSquad] = useState(false);

  // Test Mode / Simulation states
  const [isTestMode, setIsTestMode] = useState(false);
  const [isObtainingGPS, setIsObtainingGPS] = useState(false);
  const [isConfiguringTestMode, setIsConfiguringTestMode] = useState(false);
  const [testCity, setTestCity] = useState('sao_paulo');
  const [testVehicle, setTestVehicle] = useState<'walking' | 'bike' | 'moto' | 'car'>('car');
  const [testSpeedKmh, setTestSpeedKmh] = useState(40);

  const [isTelemetryMinimized, setIsTelemetryMinimized] = useState(false);
  const [isTestPanelMinimized, setIsTestPanelMinimized] = useState(false);

  const animationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (animationIntervalRef.current) {
        clearInterval(animationIntervalRef.current);
      }
    };
  }, []);

  // Active view inside the telemetry panel/bottom-nav
  const [activeTab, setActiveTab] = useState<'map' | 'squad' | 'history'>('map');

  // ============================================================================
  // Telemetry & Interactive Map States
  // ============================================================================
  // User (Você) Location: starts at São Paulo center (45% top, 50% left)
  const [userCoords, setUserCoords] = useState({
    lat: -23.547,
    lng: -46.63,
    speed: 0,
    heading: 0
  });

  const [userTrail, setUserTrail] = useState<{ lat: number; lng: number }[]>([]);
  const [showTrail, setShowTrail] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('rastro_show_trail');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('rastro_show_trail', String(showTrail));
    }
  }, [showTrail]);

  const [useGPSReal, setUseGPSReal] = useState(true);
  const [simulationActive, setSimulationActive] = useState(true);
  const [selectedTeammate, setSelectedTeammate] = useState<string | null>(null);
  const [activeNotification, setActiveNotification] = useState<{ message: string; type: 'success' | 'alert' | 'info' } | null>(null);
  const [mapAuthError, setMapAuthError] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return !!(window as any).gm_auth_failed_triggered;
    }
    return false;
  });

  // Background map position adjustments (simulating drag/recentering offset)
  const [bgPosition, setBgPosition] = useState('50% 50%');

  // Manual & automatic log entries
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: '1', time: '12:45:10', type: 'auto', lat: -23.547, lng: -46.63, note: 'Sessão iniciada na base tática.', callsign: 'GHOST_LEADER' },
  ]);

  // Teammates database (live state in Sao Paulo vicinity)
  const [teammates, setTeammates] = useState<Teammate[]>(() => []);

  // ============================================================================
  // Notifications Handler helper (Memoized to prevent render impurities)
  // ============================================================================
  const triggerNotification = React.useCallback((message: string, type: 'success' | 'alert' | 'info' = 'success') => {
    if (silentMode && type === 'info') return;
    setActiveNotification({ message, type });
    setTimeout(() => {
      setActiveNotification(null);
    }, 4000);
  }, [silentMode]);

  // ============================================================================
  // Google Maps Auth Failure & Error Interception Handler
  // ============================================================================
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleAuthFailed = () => {
        setMapAuthError(true);
      };

      window.addEventListener('gm_auth_failed', handleAuthFailed);
      
      return () => {
        window.removeEventListener('gm_auth_failed', handleAuthFailed);
      };
    }
  }, []);

  // ============================================================================
  // Robust Geolocation Helper (Dual GPS fallback + Dual IP Geolocation fallback)
  // ============================================================================
  const tryIPFallback = async (
    onSuccess: (lat: number, lng: number, source: 'gps_high' | 'gps_low' | 'ip_fallback' | 'default') => void,
    onFinish?: () => void
  ) => {
    try {
      // Attempt 1: freeipapi.com (No API key, full CORS, accurate and free)
      const res = await fetch('https://freeipapi.com/api/json');
      if (res.ok) {
        const data = await res.json();
        if (data.latitude && data.longitude) {
          onSuccess(data.latitude, data.longitude, 'ip_fallback');
          if (onFinish) onFinish();
          return;
        }
      }
    } catch (e) {
      console.warn("freeipapi.com fallback failed, trying ipapi.co...", e);
    }

    try {
      // Attempt 2: ipapi.co (HTTPS fallback, reliable)
      const res = await fetch('https://ipapi.co/json/');
      if (res.ok) {
        const data = await res.json();
        if (data.latitude && data.longitude) {
          onSuccess(data.latitude, data.longitude, 'ip_fallback');
          if (onFinish) onFinish();
          return;
        }
      }
    } catch (e) {
      console.warn("ipapi.co fallback failed, defaulting to Sao Paulo", e);
    }

    // Default ultimate fallback: Sao Paulo Center
    onSuccess(-23.5505, -46.6333, 'default');
    if (onFinish) onFinish();
  };

  const tryLowAccuracy = (
    onSuccess: (lat: number, lng: number, source: 'gps_high' | 'gps_low' | 'ip_fallback' | 'default') => void,
    onFinish?: () => void
  ) => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      tryIPFallback(onSuccess, onFinish);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        if (latitude && longitude) {
          onSuccess(latitude, longitude, 'gps_low');
          if (onFinish) onFinish();
        } else {
          tryIPFallback(onSuccess, onFinish);
        }
      },
      (err) => {
        console.warn("Low accuracy GPS failed, trying IP fallback...", err);
        tryIPFallback(onSuccess, onFinish);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  };

  const getBestLocation = (
    onSuccess: (lat: number, lng: number, source: 'gps_high' | 'gps_low' | 'ip_fallback' | 'default') => void,
    onFinish?: () => void
  ) => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      tryIPFallback(onSuccess, onFinish);
      return;
    }

    // Attempt 1: High Accuracy
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        if (latitude && longitude) {
          onSuccess(latitude, longitude, 'gps_high');
          if (onFinish) onFinish();
        } else {
          tryLowAccuracy(onSuccess, onFinish);
        }
      },
      (err) => {
        console.warn("High accuracy GPS failed, trying low accuracy...", err);
        if (err.code === 1) {
          // Explicit permission denied. Don't retry low accuracy, go straight to IP fallback
          tryIPFallback(onSuccess, onFinish);
        } else {
          // Timeout or Position Unavailable
          tryLowAccuracy(onSuccess, onFinish);
        }
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );
  };

  // ============================================================================
  // Squad URL & localStorage Loader Hook
  // ============================================================================
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const queryParams = new URLSearchParams(window.location.search);
    const esquadraoParam = queryParams.get('esquadrao');

    const savedSquadId = localStorage.getItem('rastro_squad_id');
    const savedCallsign = localStorage.getItem('rastro_callsign');
    const savedColor = localStorage.getItem('rastro_marker_color');

    if (savedColor) {
      // Already handled during state initialization above
    }

    if (esquadraoParam) {
      const squadIdUpper = esquadraoParam.trim().toUpperCase();
      const loadSquad = async () => {
        setIsLoadingSquad(true);
        try {
          const res = await fetch(`/api/squad/${squadIdUpper}`);
          if (res.ok) {
            setSquadId(squadIdUpper);
            setShowIdentityStep(true);
            setScreen('squad-setup');
            triggerNotification(`Conectado ao esquadrão ${squadIdUpper}`, 'success');
          } else {
            setSquadError('Este link de esquadrão não é válido ou expirou.');
            setScreen('squad-setup');
            setShowIdentityStep(false);
          }
        } catch (err) {
          console.warn('Busca de esquadrão offline:', err);
          setSquadError('Erro de conexão ao buscar esquadrão.');
          setScreen('squad-setup');
        } finally {
          setIsLoadingSquad(false);
        }
      };
      loadSquad();
    } else if (savedSquadId && savedCallsign) {
      const squadIdUpper = savedSquadId.trim().toUpperCase();
      const restoreSquad = async () => {
        setIsLoadingSquad(true);
        try {
          const res = await fetch(`/api/squad/${squadIdUpper}`);
          if (res.ok) {
            setSquadId(squadIdUpper);
            setCallsign(savedCallsign);
            
            // Turn on trail automatically on entry/restoration
            setShowTrail(true);

            // Force precise GPS on restore with robust fallback
            triggerNotification('Restaurando sessão. Obtendo localização...', 'info');
            getBestLocation(
              (lat, lng, source) => {
                setUserCoords(prev => ({ ...prev, lat, lng }));
                setUserTrail([{ lat, lng }]);
                setLocationGranted(true);
                
                if (source === 'gps_high' || source === 'gps_low') {
                  setUseGPSReal(true);
                  triggerNotification(`Sessão restaurada no esquadrão ${squadIdUpper}`, 'success');
                } else {
                  setUseGPSReal(false);
                  if (source === 'ip_fallback') {
                    triggerNotification(`Sessão restaurada via IP (${squadIdUpper})`, 'success');
                  } else {
                    triggerNotification(`Sessão restaurada com localização padrão (${squadIdUpper})`, 'success');
                  }
                }
                
                setScreen('map');
                setIsLoadingSquad(false);
              },
              () => {
                // Completed callback
              }
            );
          } else {
            localStorage.removeItem('rastro_squad_id');
            localStorage.removeItem('rastro_callsign');
            setScreen('onboarding');
            triggerNotification('Seu esquadrão anterior expirou ou não existe mais.', 'alert');
            setIsLoadingSquad(false);
          }
        } catch (err) {
          console.warn('Sessão offline, carregando simulador:', err);
          setSquadId(squadIdUpper);
          setCallsign(savedCallsign);
          setShowTrail(true);
          setScreen('map');
          triggerNotification('Offline: Sincronizando localmente.', 'alert');
          setIsLoadingSquad(false);
        }
      };
      restoreSquad();
    }
  }, [triggerNotification]);

  // ============================================================================
  // Squad Real-time Telemetry Synchronization Polling Loop
  // ============================================================================
  const telemetryStateRef = useRef({
    screen,
    squadId,
    callsign,
    userCoords,
    userTrail,
    markerColor,
    isTestMode
  });

  useEffect(() => {
    telemetryStateRef.current = {
      screen,
      squadId,
      callsign,
      userCoords,
      userTrail,
      markerColor,
      isTestMode
    };
  }, [screen, squadId, callsign, userCoords, userTrail, markerColor, isTestMode]);

  useEffect(() => {
    if (screen !== 'map' || !squadId) return;

    let isSubscribed = true;

    const syncTelemetry = async () => {
      const state = telemetryStateRef.current;
      if (state.screen !== 'map' || !state.squadId || !state.callsign || state.isTestMode) return;

      try {
        const activeColorTheme = COLOR_SPECTRUM.find(c => c.id === state.markerColor) || COLOR_SPECTRUM[0];
        
        const payload = {
          name: state.callsign,
          lat: state.userCoords.lat,
          lng: state.userCoords.lng,
          speed: state.userCoords.speed,
          status: 'live', // real user is active when page is open
          color: activeColorTheme.textClass,
          borderColor: activeColorTheme.borderClass,
          trail: state.userTrail, 
        };

        const res = await fetch(`/api/squad/${state.squadId}/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          throw new Error('Sync telemetry failed');
        }

        const data = await res.json();
        
        if (isSubscribed && data.success) {
          const cleanMyName = state.callsign.trim().toUpperCase();
          const filteredTeammates = data.members.filter(
            (m: any) => m.name.trim().toUpperCase() !== cleanMyName
          );
          
          setTeammates(filteredTeammates);
          setLogs(data.logs);
        }
      } catch (error) {
        console.warn('Error syncing telemetry with server:', error);
      }
    };

    // Immediate sync
    syncTelemetry();

    // Poll every 1.5s (quase ao vivo)
    const interval = setInterval(syncTelemetry, 1500);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [screen, squadId]);


  const mapContainerRef = useRef<HTMLDivElement>(null);

  const handleMapClick = async (targetLat: number, targetLng: number) => {
    if (!isTestMode && useGPSReal) return;

    if (animationIntervalRef.current) {
      clearInterval(animationIntervalRef.current);
      animationIntervalRef.current = null;
    }

    const transportNames: Record<string, string> = {
      walking: 'Caminhada (5 km/h)',
      bike: 'Bicicleta (15 km/h)',
      moto: 'Moto (35 km/h)',
      car: 'Carro (40 km/h)',
    };

    const startLat = userCoords.lat;
    const startLng = userCoords.lng;

    // Only initialize if empty, do not reset so that subsequent destination clicks continue the existing trail!
    setUserTrail(prev => prev.length === 0 ? [{ lat: startLat, lng: startLng }] : prev);

    const profile = testVehicle === 'walking' ? 'foot' : 'driving';
    triggerNotification('Simulação: Calculando trajeto pelas ruas...', 'info');

    let routeCoords: [number, number][];
    try {
      routeCoords = await fetchRouteSegment(profile, startLng, startLat, targetLng, targetLat);
    } catch (e) {
      console.warn("Could not calculate street route, using straight line fallback.", e);
      routeCoords = [
        [startLng, startLat],
        [targetLng, targetLat]
      ];
    }

    // Compute actual distance along the route segment coordinates
    let totalDistance = 0;
    for (let i = 0; i < routeCoords.length - 1; i++) {
      totalDistance += getDistanceKm(routeCoords[i][1], routeCoords[i][0], routeCoords[i + 1][1], routeCoords[i + 1][0]);
    }

    if (totalDistance < 0.001) {
      triggerNotification('Você já está no destino!', 'info');
      return;
    }

    triggerNotification(`Simulação: Iniciando trajeto via ${transportNames[testVehicle] || 'Carro'}`, 'info');

    const speed = testSpeedKmh;
    const timeHours = totalDistance / speed;
    const timeSeconds = timeHours * 3600;

    // Adjust multiplier to make walking speed visible and vehicle speeds feel fast but natural
    const multiplier = testVehicle === 'walking' ? 40 : 120;
    const simulatedDurationSec = timeSeconds / multiplier;

    const stepIntervalMs = 100;
    const totalSteps = Math.max(15, Math.round((simulatedDurationSec * 1000) / stepIntervalMs));

    let currentStep = 0;

    setUserCoords(prev => ({
      ...prev,
      speed: speed,
    }));

    animationIntervalRef.current = setInterval(() => {
      currentStep++;
      
      const ratio = currentStep / totalSteps;
      const nextPos = getPointAlongPath(routeCoords, ratio);

      if (currentStep >= totalSteps) {
        // Destination reached
        setUserCoords(prev => {
          const finalHeading = calculateBearing(prev.lat, prev.lng, targetLat, targetLng) || prev.heading;
          setUserTrail(trail => {
            const last = trail[trail.length - 1];
            if (last) {
              const dist = getDistanceKm(last.lat, last.lng, targetLat, targetLng);
              if (dist < 0.003) return trail;
            }
            const updated = [...trail, { lat: targetLat, lng: targetLng }];
            return updated;
          });
          return {
            lat: targetLat,
            lng: targetLng,
            speed: 0,
            heading: finalHeading,
          };
        });

        const now = new Date();
        setLogs(prev => [
          {
            id: String(Date.now()),
            time: now.toLocaleTimeString(),
            type: 'auto',
            lat: targetLat,
            lng: targetLng,
            note: `Simulação concluída: ${transportNames[testVehicle] || 'Carro'}. Distância: ${totalDistance.toFixed(2)} km.`,
            callsign: callsign,
          },
          ...prev,
        ]);

        if (animationIntervalRef.current) {
          clearInterval(animationIntervalRef.current);
          animationIntervalRef.current = null;
        }
        triggerNotification('Destino alcançado!', 'success');
      } else {
        setUserCoords(prev => {
          const currentHeading = calculateBearing(prev.lat, prev.lng, nextPos.lat, nextPos.lng) || prev.heading;
          setUserTrail(trail => {
            const last = trail[trail.length - 1];
            if (last) {
              const dist = getDistanceKm(last.lat, last.lng, nextPos.lat, nextPos.lng);
              if (dist < 0.003) return trail;
            }
            const updated = [...trail, { lat: nextPos.lat, lng: nextPos.lng }];
            return updated;
          });
          return {
            lat: nextPos.lat,
            lng: nextPos.lng,
            speed: speed,
            heading: currentHeading,
          };
        });
      }
    }, stepIntervalMs);
  };

  // ============================================================================
  // Browser Geolocation API Hook
  // ============================================================================
  useEffect(() => {
    if (locationGranted && useGPSReal) {
      if (typeof window !== 'undefined' && navigator.geolocation) {
        const watchId = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude, longitude, speed, heading } = position.coords;
            setUserCoords({
              lat: latitude,
              lng: longitude,
              speed: speed ? Math.round(speed * 3.6) : 0, // convert m/s to km/h
              heading: heading || 0
            });
            setUserTrail(prev => {
              if (prev.length === 0) {
                return [{ lat: latitude, lng: longitude }];
              }
              const last = prev[prev.length - 1];
              const dist = getDistanceKm(last.lat, last.lng, latitude, longitude);
              if (dist >= 0.003) { // 3 meters
                const updated = [...prev, { lat: latitude, lng: longitude }];
                return updated;
              }
              return prev;
            });
          },
          (error) => {
            console.warn("GPS telemetry warning:", error);
            if (error.code === 1) { // PERMISSION_DENIED
              triggerNotification('Permissão de localização negada.', 'alert');
              setUseGPSReal(false);
              setShowLocationHelpModal(true);
            } else {
              console.log('GPS temporarily unavailable, retrying...');
            }
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
        return () => navigator.geolocation.clearWatch(watchId);
      }
    }
  }, [locationGranted, useGPSReal, triggerNotification]);

  // ============================================================================
  // Teammates Real-time Simulation Loop handled by server synchronization
  // ============================================================================


  // ============================================================================
  // Onboarding Interaction Handlers
  // ============================================================================
  const requestLocationPermission = () => {
    triggerNotification('Obtendo localização...', 'info');
    getBestLocation((lat, lng, source) => {
      setLocationGranted(true);
      setUserCoords(prev => ({ ...prev, lat, lng }));
      setUserTrail([{ lat, lng }]);
      
      if (source === 'gps_high' || source === 'gps_low') {
        setUseGPSReal(true);
        triggerNotification('Permissão de Localização concedida com sucesso.', 'success');
      } else {
        setUseGPSReal(false);
        if (source === 'ip_fallback') {
          triggerNotification('GPS indisponível. Localização aproximada obtida via IP!', 'info');
        } else {
          triggerNotification('Não foi possível obter localização. Usando São Paulo.', 'alert');
        }
      }
    });
  };

  const requestNotificationPermission = () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      Notification.requestPermission().then(permission => {
        setNotificationsGranted(permission === 'granted');
        triggerNotification('Notificações ativadas no terminal.', 'success');
      });
    } else {
      setNotificationsGranted(true);
      triggerNotification('Notificações ativadas com sucesso.', 'success');
    }
  };

  const handleStartTestMode = (e: React.FormEvent) => {
    e.preventDefault();
    setUseGPSReal(false);

    let speedVal = 40;
    if (testVehicle === 'walking') speedVal = 5;
    else if (testVehicle === 'bike') speedVal = 15;
    else if (testVehicle === 'moto') speedVal = 35;
    else if (testVehicle === 'car') speedVal = 40;

    setTestSpeedKmh(speedVal);

    const finalizeStart = (lat: number, lng: number) => {
      setUserCoords({
        lat,
        lng,
        speed: 0,
        heading: 0
      });
      setUserTrail([{ lat, lng }]);
      setShowTrail(true);
      setSquadId('TEST_MODE');
      setIsTestMode(true);
      setScreen('map');
      triggerNotification('Modo de Teste Ativado: Clique em qualquer ponto do mapa para iniciar simulação.', 'success');
    };

    if (testCity === 'my_location') {
      setIsObtainingGPS(true);
      
      const hasRealCoords = (userCoords.lat !== -23.547 || userCoords.lng !== -46.63) && 
                            (userCoords.lat !== -23.5505 || userCoords.lng !== -46.6333);
      
      if (hasRealCoords) {
        setIsObtainingGPS(false);
        setShowTrail(true);
        finalizeStart(userCoords.lat, userCoords.lng);
      } else {
        getBestLocation((lat, lng, source) => {
          setIsObtainingGPS(false);
          setShowTrail(true);
          if (source === 'gps_high' || source === 'gps_low') {
            triggerNotification('Localização obtida via GPS.', 'success');
          } else if (source === 'ip_fallback') {
            triggerNotification('GPS indisponível. Localização aproximada obtida via IP.', 'info');
          } else {
            triggerNotification('Usando localização padrão de São Paulo.', 'alert');
          }
          finalizeStart(lat, lng);
        });
      }
    } else {
      let startLat = -23.5505;
      let startLng = -46.6333;

      if (testCity === 'sao_paulo') {
        startLat = -23.5505;
        startLng = -46.6333;
      } else if (testCity === 'rio') {
        startLat = -22.9068;
        startLng = -43.1729;
      } else if (testCity === 'brasilia') {
        startLat = -15.7975;
        startLng = -47.8919;
      } else if (testCity === 'belo_horizonte') {
        startLat = -19.9167;
        startLng = -43.9345;
      } else if (testCity === 'lisboa') {
        startLat = 38.7223;
        startLng = -9.1393;
      }

      finalizeStart(startLat, startLng);
    }
  };

  // ============================================================================
  // Squad Operations Handlers
  // ============================================================================
  const handleCreateSquad = async () => {
    setIsLoadingSquad(true);
    setSquadError('');
    try {
      const res = await fetch('/api/squad', {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to create');
      const data = await res.json();
      
      setSquadId(data.id);
      setSquadInput('');
      setIsNewSquad(true);
      setShowIdentityStep(true);
      triggerNotification(`Esquadrão ${data.id} criado!`, 'success');
    } catch (err) {
      console.warn(err);
      setSquadError('Falha de rede ao criar esquadrão tático.');
    } finally {
      setIsLoadingSquad(false);
    }
  };

  const handleJoinSquadByCode = async (code: string) => {
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
      setSquadError('Digite ou cole um código/link válido.');
      return;
    }

    setIsLoadingSquad(true);
    setSquadError('');
    try {
      let idToFetch = cleanCode;
      // If code contains the esquadrao query param, try to parse it
      if (cleanCode.includes('?') || cleanCode.includes('ESQUADRAO=')) {
        try {
          const urlObj = new URL(code.trim());
          const param = urlObj.searchParams.get('esquadrao');
          if (param) {
            idToFetch = param.trim().toUpperCase();
          }
        } catch (e) {
          const match = code.match(/[?&]esquadrao=([A-Z0-9]+)/i);
          if (match && match[1]) {
            idToFetch = match[1].trim().toUpperCase();
          }
        }
      }

      const res = await fetch(`/api/squad/${idToFetch}`);
      if (!res.ok) {
        setSquadError('Esse link de esquadrão não é válido ou expirou.');
        return;
      }
      
      setSquadId(idToFetch);
      setIsNewSquad(false);
      setShowIdentityStep(true);
      triggerNotification(`Canal de esquadrão ${idToFetch} estabelecido!`, 'success');
    } catch (err) {
      console.warn(err);
      setSquadError('Erro de conexão com a rede tática.');
    } finally {
      setIsLoadingSquad(false);
    }
  };

  const handleFinalizeIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!callsign.trim()) {
      triggerNotification('Por favor, informe seu Callsign.', 'alert');
      return;
    }

    setIsLoadingSquad(true);

    const joinSquadAndEnter = async (lat?: number, lng?: number) => {
      try {
        const valRes = await fetch(`/api/squad/${squadId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: callsign }),
        });

        if (!valRes.ok) {
          const errData = await valRes.json();
          setSquadError(errData.error || 'Este nome já está ativo no esquadrão.');
          triggerNotification(errData.error || 'Nome já em uso no esquadrão.', 'alert');
          setIsLoadingSquad(false);
          return;
        }

        localStorage.setItem('rastro_squad_id', squadId);
        localStorage.setItem('rastro_callsign', callsign);
        localStorage.setItem('rastro_marker_color', markerColor);

        // Turn on the trail automatically
        setShowTrail(true);

        triggerNotification('Acesso concedido. Sincronizando com a equipe...', 'success');
        setTimeout(() => {
          setScreen('map');
          setIsLoadingSquad(false);
        }, 1000);
      } catch (err) {
        console.warn(err);
        triggerNotification('Erro ao conectar ao canal de esquadrão.', 'alert');
        setIsLoadingSquad(false);
      }
    };

    if (!useGPSReal) {
      triggerNotification('Sincronizando coordenadas virtuais...', 'info');
      tryIPFallback(
        (lat, lng, source) => {
          setUserCoords(prev => ({ ...prev, lat, lng }));
          setUserTrail([{ lat, lng }]);
          setLocationGranted(true);
          setUseGPSReal(false);
          
          if (source === 'ip_fallback') {
            triggerNotification('Conectado via GPS Virtual (posição aproximada por IP)!', 'info');
          } else {
            triggerNotification('Conectado via GPS Virtual (posição padrão).', 'alert');
          }
          
          joinSquadAndEnter(lat, lng);
        },
        () => {}
      );
      return;
    }

    triggerNotification('Obtendo localização...', 'info');
    getBestLocation(
      (lat, lng, source) => {
        setUserCoords(prev => ({ ...prev, lat, lng }));
        setUserTrail([{ lat, lng }]);
        setLocationGranted(true);
        
        if (source === 'gps_high' || source === 'gps_low') {
          setUseGPSReal(true);
          triggerNotification('Localização real obtida.', 'success');
        } else {
          setUseGPSReal(false);
          if (source === 'ip_fallback') {
            triggerNotification('GPS indisponível. Localização aproximada por IP ativada!', 'info');
          } else {
            triggerNotification('GPS indisponível. Iniciando com localização padrão.', 'alert');
          }
        }
        
        joinSquadAndEnter(lat, lng);
      },
      () => {
        // completed
      }
    );
  };

  // ============================================================================
  // Map Clicking & Relocation handler
  // ============================================================================
  // Manual Check-in logging
  const triggerManualCheckIn = async () => {
    const timeStr = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const newEntry: LogEntry = {
      id: String(Date.now()),
      time: timeStr,
      type: 'manual',
      lat: userCoords.lat,
      lng: userCoords.lng,
      note: 'Check-in manual emitido via telemetria.',
      callsign: callsign
    };

    try {
      const res = await fetch(`/api/squad/${squadId}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', log: newEntry, callsign })
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
        triggerNotification('Check-in emitido com sucesso ao canal central.', 'success');
      } else {
        throw new Error('Failed to send log to squad network');
      }
    } catch (e) {
      console.warn(e);
      setLogs(prev => [newEntry, ...prev]);
      triggerNotification('Check-in emitido localmente.', 'success');
    }
  };

  // Get selected color spec objects
  const activeColorTheme = COLOR_SPECTRUM.find(c => c.id === markerColor) || COLOR_SPECTRUM[0];

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden flex flex-col justify-between selection:bg-primary-container selection:text-on-primary-container">
      
      {/* Dynamic Active Notification Overlay */}
      <AnimatePresence>
        {activeNotification && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] w-11/12 max-w-sm"
          >
            <div className="glass-panel rounded-xl px-4 py-3 shadow-[0_0_25px_rgba(0,0,0,0.5)] flex items-center gap-3 border-l-4 border-l-primary-container">
              {activeNotification.type === 'success' && <Check className="w-5 h-5 text-primary-container shrink-0" />}
              {activeNotification.type === 'alert' && <AlertTriangle className="w-5 h-5 text-secondary shrink-0" />}
              {activeNotification.type === 'info' && <Radio className="w-5 h-5 text-tertiary-container shrink-0" />}
              <span className="font-mono text-xs leading-relaxed text-on-surface">
                {activeNotification.message}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============================================================================
          SCREEN 1: ONBOARDING SCREEN
          ============================================================================ */}
      {screen === 'onboarding' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex-1 flex flex-col justify-between min-h-screen relative py-12"
        >
          {/* Header */}
          <header className="flex justify-between items-center px-4 h-16 w-[calc(100%-32px)] mx-auto z-50 fixed top-4 left-4 right-4 rounded-xl border border-outline-variant/30 shadow-md bg-surface/80 backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <Compass className="w-6 h-6 text-primary-container animate-pulse" />
              <span className="font-sans font-black tracking-tighter text-2xl text-primary-container">RASTRO</span>
            </div>
            <div className="font-mono text-xs text-on-surface-variant flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-error animate-pulse"></span>
              SYS.INIT
            </div>
          </header>

          {/* Main Onboarding Canvas */}
          <main className="flex-1 flex flex-col items-center justify-center px-4 pt-32 pb-32 z-10 w-full max-w-2xl mx-auto">
            
            {/* Pulsing Radar Graphic */}
            <div className="relative w-48 h-48 md:w-64 md:h-64 mb-8 rounded-full border border-outline-variant/50 shadow-[0_0_35px_rgba(0,255,65,0.08)] flex items-center justify-center overflow-hidden bg-surface-container-low/50 backdrop-blur-sm">
              <div className="absolute inset-0 border border-outline-variant/10 rounded-full scale-75"></div>
              <div className="absolute inset-0 border border-outline-variant/10 rounded-full scale-50"></div>
              <div className="absolute inset-0 border border-outline-variant/10 rounded-full scale-25"></div>
              <div className="w-full h-[1px] bg-outline-variant/20 absolute"></div>
              <div className="h-full w-[1px] bg-outline-variant/20 absolute"></div>
              <div className="radar-sweep"></div>
              
              <Compass className="w-12 h-12 text-primary-container relative z-10 animate-spin-slow" />
              
              {/* Simulated pings */}
              <div className="ping" style={{ top: '30%', left: '60%', animation: 'ping-fade 4s 0.5s infinite' }}></div>
              <div className="ping" style={{ top: '70%', left: '40%', animation: 'ping-fade 4s 2.1s infinite' }}></div>
            </div>

            {/* Typography */}
            <div className="text-center mb-8 w-full">
              <h1 className="font-sans font-bold text-3xl md:text-4xl text-on-surface mb-3 tracking-tight">
                Sempre Conectados
              </h1>
              <p className="font-sans text-base text-on-surface-variant max-w-md mx-auto leading-relaxed">
                Para manter sua equipe informada, o Rastro precisa de acesso à sua localização e notificações em segundo plano.
              </p>
              <div className="mt-4 inline-flex items-center justify-center gap-2 font-mono text-xs text-outline bg-surface-container/50 px-3 py-1.5 rounded border border-outline-variant/30">
                <RotateCw className="w-4.5 h-4.5 animate-spin-slow" />
                FREQ: 10-15s (QUANDO ATIVO)
              </div>
            </div>

            {/* Action Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-xl">
              
              {/* Location Permission Card */}
              <button
                id="permission_location_btn"
                onClick={requestLocationPermission}
                className="group relative bg-surface-container/80 hover:bg-surface-bright/40 border border-outline-variant/50 hover:border-primary-container/50 rounded-xl p-4 text-left transition-all duration-300 overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary-container/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="relative z-10 flex items-start gap-4">
                  <div className="bg-surface-container-high p-2 rounded-lg border border-outline-variant/30 group-hover:border-primary-container/30 transition-colors">
                    <MapPin className="w-5 h-5 text-on-surface group-hover:text-primary-container transition-colors" />
                  </div>
                  <div>
                    <h3 className="font-mono text-sm text-on-surface mb-1 group-hover:text-primary-container transition-colors font-bold">
                      Permitir Localização
                    </h3>
                    <p className="font-mono text-xs text-on-surface-variant leading-relaxed">
                      Atualiza apenas quando o app está aberto ou via check-in.
                    </p>
                  </div>
                </div>
                {/* Status indicator */}
                <div className="absolute top-4 right-4 flex h-2.5 w-2.5">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${locationGranted ? 'bg-primary-container' : 'bg-outline'}`}></span>
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${locationGranted ? 'bg-primary-container' : 'bg-outline-variant'}`}></span>
                </div>
              </button>

              {/* Notification Permission Card */}
              <button
                id="permission_notification_btn"
                onClick={requestNotificationPermission}
                className="group relative bg-surface-container/80 hover:bg-surface-bright/40 border border-outline-variant/50 hover:border-primary-container/50 rounded-xl p-4 text-left transition-all duration-300 overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary-container/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="relative z-10 flex items-start gap-4">
                  <div className="bg-surface-container-high p-2 rounded-lg border border-outline-variant/30 group-hover:border-primary-container/30 transition-colors">
                    <Bell className="w-5 h-5 text-on-surface group-hover:text-primary-container transition-colors" />
                  </div>
                  <div>
                    <h3 className="font-mono text-sm text-on-surface mb-1 group-hover:text-primary-container transition-colors font-bold">
                      Ativar Notificações
                    </h3>
                    <p className="font-mono text-xs text-on-surface-variant leading-relaxed">
                      Receba alertas cruciais e solicitações de check-in do esquadrão.
                    </p>
                  </div>
                </div>
                {/* Status indicator */}
                <div className="absolute top-4 right-4 flex h-2.5 w-2.5">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${notificationsGranted ? 'bg-primary-container' : 'bg-outline'}`}></span>
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${notificationsGranted ? 'bg-primary-container' : 'bg-outline-variant'}`}></span>
                </div>
              </button>
            </div>
          </main>

          {/* Bottom Action Area */}
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-surface via-surface/90 to-transparent z-50">
            <div className="max-w-2xl mx-auto">
              <button
                id="btn_onboarding_next"
                onClick={() => setScreen('squad-setup')}
                className="w-full bg-primary-container hover:bg-[#00e639] text-on-primary-container font-mono text-sm font-bold py-4 px-6 rounded-full flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-[0_0_20px_rgba(0,255,65,0.2)] hover:shadow-[0_0_30px_rgba(0,255,65,0.4)]"
              >
                Começar Agora
                <ArrowRight className="w-5 h-5 text-on-primary-container" />
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* ============================================================================
          SCREEN 2: SQUAD SETUP & IDENTITY SCREEN
          ============================================================================ */}
      {screen === 'squad-setup' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex-1 flex flex-col justify-center items-center min-h-screen h-auto py-12 w-full relative overflow-y-auto"
        >
          {/* Background topographic map mockup overlay */}
          <div 
            className="absolute inset-0 z-0 bg-cover bg-center filter brightness-50 contrast-125 saturate-50"
            style={{ 
              backgroundImage: `url('https://www.gstatic.com/labs-code/stitch/stitch-placeholder-300x300.svg')`,
              opacity: 0.15
            }}
          ></div>
          <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#131313]/90 via-[#131313]/95 to-[#131313] pointer-events-none"></div>

          <main className="z-10 w-full max-w-md px-4 relative flex flex-col items-center">
            
            {/* Logo */}
            <div className="mb-6 text-center">
              <h1 className="text-4xl text-primary-container tracking-[0.25em] uppercase font-mono font-black">
                RASTRO
              </h1>
              <div className="flex items-center justify-center mt-3 space-x-2">
                <div className="w-2 h-2 rounded-full bg-primary-container pip-glow animate-pulse"></div>
                <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">
                  {showIdentityStep ? 'Ajustar Identidade' : 'Canal Operacional'}
                </span>
              </div>
            </div>

            {/* Error banner */}
            {squadError && (
              <div className="w-full mb-4 bg-error-container/10 border border-error/30 text-error p-3 rounded-xl font-mono text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{squadError}</span>
              </div>
            )}

            {/* Glassmorphism Form Card */}
            <div className="glass-panel rounded-2xl p-6 md:p-8 w-full flex flex-col gap-6 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-[1px] bg-primary-container opacity-20"></div>

              {!showIdentityStep ? (
                /* PHASE 1: CHOOSE OR ENTER SQUAD */
                <div className="flex flex-col gap-6">
                  <div className="text-center">
                    <p className="font-sans text-sm text-on-surface-variant">
                      Crie um novo esquadrão tático ou conecte-se a um grupo operacional ativo usando o convite.
                    </p>
                  </div>

                  {/* Option 1: Create Squad */}
                  <button
                    onClick={handleCreateSquad}
                    disabled={isLoadingSquad}
                    className="w-full relative group overflow-hidden rounded-xl bg-primary-container/10 hover:bg-primary-container/20 border border-primary-container/30 text-primary-container py-4 flex flex-col items-center gap-1 transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Plus className="w-5 h-5 font-bold" />
                      <span className="font-mono text-sm uppercase tracking-wider font-extrabold">
                        Criar Novo Esquadrão
                      </span>
                    </div>
                    <span className="font-sans text-[11px] text-primary-container/70 text-center px-2">
                      Gera um link e código exclusivo para convidar amigos
                    </span>
                  </button>

                  {/* Divider */}
                  <div className="flex items-center gap-3">
                    <div className="h-[1px] bg-outline-variant/30 flex-1"></div>
                    <span className="font-mono text-[10px] text-outline font-bold uppercase">OU</span>
                    <div className="h-[1px] bg-outline-variant/30 flex-1"></div>
                  </div>

                  {/* Option 2: Join Squad Input */}
                  <div className="flex flex-col gap-3">
                    <label className="font-mono text-[10px] text-outline uppercase font-bold" htmlFor="squad-input">
                      Inserir Código ou Link do Esquadrão
                    </label>
                    <div className="relative">
                      <input
                        id="squad-input"
                        type="text"
                        value={squadInput}
                        onChange={(e) => setSquadInput(e.target.value)}
                        placeholder="Ex: AB12CD ou cole o link inteiro"
                        className="w-full bg-surface-container-high border border-outline-variant rounded-lg py-3 px-4 text-on-surface font-mono text-sm focus:ring-1 focus:ring-primary-container focus:border-primary-container focus:outline-none transition-all placeholder:text-on-surface-variant/30"
                      />
                    </div>

                    <button
                      onClick={() => handleJoinSquadByCode(squadInput)}
                      disabled={isLoadingSquad || !squadInput.trim()}
                      className="w-full bg-surface-container-high hover:bg-surface-bright/20 border border-outline-variant hover:border-primary-container text-on-surface hover:text-primary-container rounded-lg py-3 flex items-center justify-center gap-2 transition-all font-mono text-xs uppercase tracking-wider font-bold cursor-pointer disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]"
                    >
                      {isLoadingSquad ? (
                        <RotateCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <ArrowRight className="w-4 h-4" />
                      )}
                      Conectar Canal de Rádio
                    </button>
                  </div>

                  {/* Divider */}
                  <div className="flex items-center gap-3">
                    <div className="h-[1px] bg-outline-variant/30 flex-1"></div>
                    <span className="font-mono text-[10px] text-outline font-bold uppercase">OU</span>
                    <div className="h-[1px] bg-outline-variant/30 flex-1"></div>
                  </div>

                  {/* Option 3: Test Mode Simulator */}
                  <button
                    onClick={() => {
                      setIsConfiguringTestMode(true);
                      setShowIdentityStep(true);
                      setCallsign('PILOTO_TESTE');
                    }}
                    className="w-full relative group overflow-hidden rounded-xl bg-secondary-container/10 hover:bg-[#00ff41]/20 border border-secondary border-dashed text-on-surface py-4 flex flex-col items-center gap-1 transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Compass className="w-5 h-5 font-bold text-[#00ff41] animate-pulse" />
                      <span className="font-mono text-sm uppercase tracking-wider font-extrabold text-[#00ff41]">
                        Entrar em Modo de Teste
                      </span>
                    </div>
                    <span className="font-sans text-[11px] text-on-surface-variant text-center px-2">
                      Simulador autônomo offline para testar rotas e velocidades
                    </span>
                  </button>
                </div>
              ) : isConfiguringTestMode ? (
                /* PHASE 2 (TEST MODE): CONFIGURE TEST MODE SIMULATOR */
                <form onSubmit={handleStartTestMode} className="flex flex-col gap-5">
                  <div className="bg-[#00ff41]/5 border border-[#00ff41]/20 rounded-xl p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-primary-container" />
                      <span className="font-mono text-[10px] text-on-surface-variant font-bold">MODO DE TESTE</span>
                    </div>
                    <span className="font-mono text-[10px] font-black text-[#00ff41] bg-[#00ff41]/10 border border-[#00ff41]/20 px-2 py-0.5 rounded animate-pulse">
                      SIMULADOR
                    </span>
                  </div>

                  {/* Callsign Input */}
                  <div className="flex flex-col gap-2">
                    <label className="font-mono text-[10px] text-outline uppercase font-bold" htmlFor="callsign-setup">
                      Callsign [Nome no Radar]
                    </label>
                    <input
                      id="callsign-setup"
                      type="text"
                      required
                      value={callsign}
                      onChange={(e) => setCallsign(e.target.value.toUpperCase())}
                      placeholder="Ex: PILOTO_TESTE"
                      maxLength={15}
                      className="w-full bg-surface-container-high border border-outline-variant rounded-lg py-3 px-4 text-on-surface font-mono text-sm focus:ring-1 focus:ring-primary-container focus:border-primary-container focus:outline-none transition-all"
                    />
                  </div>

                  {/* Choose Starting City */}
                  <div className="flex flex-col gap-2">
                    <label className="font-mono text-[10px] text-outline uppercase font-bold">
                      Ponto de Início (Cidade ou GPS)
                    </label>
                    <select
                      value={testCity}
                      onChange={(e) => setTestCity(e.target.value)}
                      className="w-full bg-surface-container-high border border-outline-variant rounded-lg py-3 px-4 text-on-surface font-mono text-sm focus:ring-1 focus:ring-primary-container focus:border-primary-container focus:outline-none transition-all"
                    >
                      <option value="sao_paulo">São Paulo, SP</option>
                      <option value="rio">Rio de Janeiro, RJ</option>
                      <option value="brasilia">Brasília, DF</option>
                      <option value="belo_horizonte">Belo Horizonte, MG</option>
                      <option value="lisboa">Lisboa, Portugal</option>
                      <option value="my_location">Minha Localização Atual (GPS)</option>
                    </select>
                  </div>

                  {/* Choose Vehicle / Speed */}
                  <div className="flex flex-col gap-2">
                    <label className="font-mono text-[10px] text-outline uppercase font-bold">
                      Meio de Transporte & Velocidade
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'walking', label: 'Caminhada', speed: '5 km/h' },
                        { id: 'bike', label: 'Bicicleta', speed: '15 km/h' },
                        { id: 'moto', label: 'Moto', speed: '35 km/h' },
                        { id: 'car', label: 'Carro', speed: '40 km/h' },
                      ].map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setTestVehicle(v.id as any)}
                          className={`p-2.5 rounded-lg border text-left flex flex-col gap-0.5 transition-all cursor-pointer ${
                            testVehicle === v.id
                              ? 'bg-primary-container/10 border-[#00ff41] text-[#00ff41]'
                              : 'bg-surface-container-high border-outline-variant text-on-surface hover:border-outline hover:bg-surface-bright/10'
                          }`}
                        >
                          <span className="font-mono text-xs font-bold uppercase">{v.label}</span>
                          <span className="font-mono text-[10px] opacity-70">{v.speed}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Radar Color Signature */}
                  <div className="flex flex-col gap-2">
                    <label className="font-mono text-[10px] text-outline uppercase font-bold">
                      Espectro de Assinatura do Radar [Cor]
                    </label>
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                      {COLOR_SPECTRUM.map((color) => (
                        <button
                          key={color.id}
                          type="button"
                          onClick={() => setMarkerColor(color.id)}
                          className="relative flex items-center justify-center p-1 rounded-full hover:scale-105 transition-all focus:outline-none"
                        >
                          <div
                            className="w-8 h-8 rounded-full border border-outline-variant transition-all"
                            style={{
                              backgroundColor: '#131313',
                              borderColor: color.hex,
                              boxShadow: markerColor === color.id ? `0 0 10px ${color.hex}` : 'none'
                            }}
                          ></div>
                          {markerColor === color.id && (
                            <div className="absolute w-2 h-2 rounded-full bg-[#131313] border" style={{ borderColor: color.hex }}></div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Submit Simulation */}
                  <button
                    type="submit"
                    disabled={isObtainingGPS}
                    className="w-full bg-primary-container hover:bg-[#00e639] text-on-primary-container rounded-lg py-3.5 flex items-center justify-center gap-2 transition-all font-mono text-xs uppercase tracking-wider font-extrabold cursor-pointer active:scale-[0.98] disabled:opacity-50"
                  >
                    {isObtainingGPS ? (
                      <>
                        <RotateCw className="w-4 h-4 text-on-primary-container animate-spin" />
                        Obtendo Localização GPS...
                      </>
                    ) : (
                      <>
                        <Compass className="w-4 h-4 text-on-primary-container animate-spin-slow" />
                        Iniciar Simulador de Teste
                      </>
                    )}
                  </button>

                  {/* Back to Phase 1 */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowIdentityStep(false);
                      setIsConfiguringTestMode(false);
                      setSquadError('');
                    }}
                    className="font-mono text-[10px] text-outline hover:text-on-surface transition-colors uppercase font-bold"
                  >
                    ← Retornar ao Menu Inicial
                  </button>
                </form>
              ) : (
                /* PHASE 2: CONFIGURE IDENTITY & COPY INVITE LINK */
                <form onSubmit={handleFinalizeIdentity} className="flex flex-col gap-5">
                  
                  {/* Shareable Invite Card (If newly created) */}
                  {isNewSquad && (
                    <div className="bg-primary-container/5 border border-primary-container/20 rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-primary-container/5 rounded-full filter blur-xl pointer-events-none"></div>
                      
                      <div>
                        <span className="font-mono text-[10px] text-[#00ff41] font-bold uppercase tracking-widest block mb-1">
                          Canal Estabelecido // Código de Convite
                        </span>
                        <div className="flex items-center justify-between gap-2 bg-surface-container-low px-3 py-2 rounded-lg border border-outline-variant/30">
                          <span className="font-mono text-lg font-black text-primary-container tracking-wider">
                            {squadId}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const link = `${window.location.origin}/?esquadrao=${squadId}`;
                              navigator.clipboard.writeText(link);
                              triggerNotification('Link do esquadrão copiado!', 'success');
                            }}
                            className="text-primary-container hover:bg-primary-container/10 p-1.5 rounded transition-all active:scale-90"
                            title="Copiar Link"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <p className="font-sans text-[11px] text-on-surface-variant leading-relaxed">
                        Compartilhe o código acima ou envie o link do Rastro para que seus amigos se juntem ao esquadrão em tempo real.
                      </p>
                    </div>
                  )}

                  {!isNewSquad && (
                    <div className="bg-surface-container-high/40 border border-outline-variant/20 rounded-xl p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-primary-container" />
                        <span className="font-mono text-xs text-on-surface-variant">Esquadrão Conectado:</span>
                      </div>
                      <span className="font-mono text-sm font-black text-primary-container bg-primary-container/10 border border-primary-container/20 px-2.5 py-0.5 rounded">
                        {squadId}
                      </span>
                    </div>
                  )}

                  {/* Callsign Input */}
                  <div className="flex flex-col gap-2">
                    <label className="font-mono text-[10px] text-outline uppercase font-bold" htmlFor="callsign-setup">
                      Callsign [Indicativo / Nome no Radar]
                    </label>
                    <div className="relative">
                      <input
                        id="callsign-setup"
                        type="text"
                        required
                        value={callsign}
                        onChange={(e) => setCallsign(e.target.value.toUpperCase())}
                        placeholder="Ex: SPECTRE_1"
                        maxLength={15}
                        className="w-full bg-surface-container-high border border-outline-variant rounded-lg py-3 px-4 text-on-surface font-mono text-sm focus:ring-1 focus:ring-primary-container focus:border-primary-container focus:outline-none transition-all"
                      />
                    </div>
                  </div>

                  {/* Marker Color Spectrum */}
                  <div className="flex flex-col gap-2">
                    <label className="font-mono text-[10px] text-outline uppercase font-bold">
                      Espectro de Assinatura do Radar [Cor]
                    </label>
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                      {COLOR_SPECTRUM.map((color) => (
                        <button
                          key={color.id}
                          type="button"
                          onClick={() => setMarkerColor(color.id)}
                          className="relative flex items-center justify-center p-1 rounded-full hover:scale-105 transition-all focus:outline-none"
                        >
                          <div
                            className="w-8 h-8 rounded-full border border-outline-variant transition-all"
                            style={{
                              backgroundColor: '#131313',
                              borderColor: color.hex,
                              boxShadow: markerColor === color.id ? `0 0 10px ${color.hex}` : 'none'
                            }}
                          ></div>
                          {markerColor === color.id && (
                            <div className="absolute w-2 h-2 rounded-full bg-[#131313] border" style={{ borderColor: color.hex }}></div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* GPS Mode selection */}
                  <div className="flex flex-col gap-2">
                    <label className="font-mono text-[10px] text-outline uppercase font-bold">
                      Modo de GPS / Posicionamento
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setUseGPSReal(true)}
                        className={`p-3 rounded-lg border text-left flex flex-col gap-0.5 transition-all cursor-pointer ${
                          useGPSReal
                            ? 'bg-primary-container/10 border-[#00ff41] text-[#00ff41]'
                            : 'bg-surface-container-high border-outline-variant text-on-surface hover:border-outline hover:bg-surface-bright/10'
                        }`}
                      >
                        <span className="font-mono text-xs font-bold uppercase">📡 GPS Real</span>
                        <span className="font-mono text-[10px] opacity-70">Posição automática do celular</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setUseGPSReal(false)}
                        className={`p-3 rounded-lg border text-left flex flex-col gap-0.5 transition-all cursor-pointer ${
                          !useGPSReal
                            ? 'bg-primary-container/10 border-[#00ff41] text-[#00ff41]'
                            : 'bg-surface-container-high border-outline-variant text-on-surface hover:border-outline hover:bg-surface-bright/10'
                        }`}
                      >
                        <span className="font-mono text-xs font-bold uppercase">📍 GPS Virtual</span>
                        <span className="font-mono text-[10px] opacity-70">Simular posição clicando no mapa</span>
                      </button>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={isLoadingSquad || !callsign.trim()}
                    className="w-full bg-primary-container hover:bg-[#00e639] text-on-primary-container rounded-lg py-3.5 flex items-center justify-center gap-2 transition-all font-mono text-xs uppercase tracking-wider font-extrabold cursor-pointer active:scale-[0.98]"
                  >
                    {isLoadingSquad ? (
                      <RotateCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Compass className="w-4 h-4 text-on-primary-container" />
                    )}
                    Entrar no Mapa Operacional
                  </button>

                  {/* Back to Phase 1 button */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowIdentityStep(false);
                      setSquadError('');
                    }}
                    className="font-mono text-[10px] text-outline hover:text-on-surface transition-colors uppercase font-bold"
                  >
                    ← Alterar Código de Esquadrão
                  </button>
                </form>
              )}

              {/* Decorative Terminal Line */}
              <div className="text-center border-t border-outline-variant/30 pt-4">
                <p className="font-mono text-[10px] text-on-surface-variant/40">
                  Canal seguro criptografado de ponta a ponta.
                </p>
              </div>
            </div>

            {/* Back to onboarding anchor */}
            <button
              onClick={() => {
                setScreen('onboarding');
                setShowIdentityStep(false);
                setSquadError('');
              }}
              className="mt-6 font-mono text-xs text-outline hover:text-primary-container transition-colors flex items-center gap-1.5"
            >
              <Compass className="w-4 h-4" />
              Retornar para o radar inicial
            </button>
          </main>
        </motion.div>
      )}

      {/* ============================================================================
          SCREEN 3: MAIN MAP SCREEN
          ============================================================================ */}
      {screen === 'map' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex-1 flex flex-col h-screen w-screen overflow-hidden relative font-sans text-on-surface select-none"
        >
          {/* Highly stylized Google Map layout */}
          <div className="absolute inset-0 z-0" id="map_canvas">
            <MapLibreMap
              userCoords={userCoords}
              userTrail={userTrail}
              teammates={teammates}
              selectedTeammate={selectedTeammate}
              setSelectedTeammate={setSelectedTeammate}
              activeColorTheme={activeColorTheme}
              callsign={callsign}
              useGPSReal={useGPSReal}
              setUseGPSReal={setUseGPSReal}
              triggerNotification={triggerNotification}
              routeProfile={routeProfile}
              onMapClick={handleMapClick}
              showTrail={showTrail}
            />
          </div>

          {/* Top header navigation */}
          <header className="fixed top-4 left-4 right-4 rounded-xl bg-surface/80 backdrop-blur-xl border border-outline-variant/30 shadow-md flex justify-between items-center px-4 h-16 z-50 transition-colors max-w-2xl mx-auto">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full ${activeColorTheme.borderClass} border-2 bg-surface-container flex items-center justify-center font-mono text-xs font-bold ${activeColorTheme.textClass}`}>
                {callsign.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs text-on-surface leading-none font-bold">{callsign}</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-container animate-pulse"></span>
                  {isTestMode ? (
                    <span className="font-mono text-[9px] text-[#00ff41] bg-[#00ff41]/10 border border-[#00ff41]/20 px-1.5 py-0.5 rounded animate-pulse">
                      TESTE 🧭
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        const link = `${window.location.origin}/?esquadrao=${squadId}`;
                        navigator.clipboard.writeText(link);
                        triggerNotification('Link do esquadrão copiado!', 'success');
                      }}
                      title="Copiar link do esquadrão"
                      className="font-mono text-[9px] text-[#00ff41] bg-[#00ff41]/10 hover:bg-[#00ff41]/20 border border-[#00ff41]/20 px-1.5 py-0.5 rounded transition-all cursor-pointer select-none active:scale-95"
                    >
                      EQ: {squadId} 📋
                    </button>
                  )}
                </div>
                <span className="font-mono text-[9px] text-[#00ff41] tracking-widest uppercase font-bold">
                  {isTestMode ? 'SIMULADOR DE ROTA' : 'SYS.LIVE'}
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-1.5">
              <span className="font-sans font-black tracking-tighter text-lg text-primary-container hidden sm:inline">
                RASTRO
              </span>
              <button
                id="btn_map_settings"
                onClick={() => setScreen('settings')}
                className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary-container hover:bg-surface-bright/20 transition-all active:scale-95 duration-200"
              >
                <SettingsIcon className="w-5 h-5" />
              </button>
            </div>
          </header>

          {(isTestMode || !useGPSReal) && (
            isTestPanelMinimized ? (
              <button
                onClick={() => setIsTestPanelMinimized(false)}
                className="fixed top-20 left-1/2 -translate-x-1/2 rounded-full bg-surface/95 backdrop-blur-xl border border-[#00ff41]/30 shadow-lg px-3 py-1.5 flex items-center gap-2 z-40 transition-all font-mono text-[9px] text-[#00ff41] font-bold uppercase active:scale-95 cursor-pointer pointer-events-auto shadow-[0_0_15px_rgba(0,255,65,0.2)]"
                title="Expandir painel de controle"
              >
                <Compass className="w-3.5 h-3.5 animate-spin-slow shrink-0 text-[#00ff41]" />
                <span>{isTestMode ? "Modo de Teste" : "GPS Virtual Ativo"}</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="fixed top-20 left-1/2 -translate-x-1/2 rounded-xl bg-surface/90 backdrop-blur-xl border border-outline-variant/30 shadow-lg px-4 py-3 flex flex-col items-center gap-3 z-40 max-w-md w-[calc(100%-32px)]">
                <div className="flex items-center gap-2 w-full">
                  <Compass className="w-5 h-5 text-[#00ff41] animate-spin-slow shrink-0" />
                  <div className="text-left w-full flex justify-between items-start">
                    <div>
                      <p className="font-mono text-[10px] text-[#00ff41] font-bold uppercase leading-none">
                        {isTestMode ? "MODO DE TESTE" : "GPS VIRTUAL OPERACIONAL"}
                      </p>
                      <p className="font-sans text-xs text-on-surface-variant mt-1 leading-tight">
                        {isTestMode 
                          ? "Simulador isolado. Clique no mapa para traçar uma rota."
                          : "Conectado à equipe! Toque no mapa para se deslocar."}
                      </p>
                    </div>
                    <button
                      onClick={() => setIsTestPanelMinimized(true)}
                      className="text-on-surface-variant hover:text-on-surface p-1 rounded hover:bg-surface-bright/15 transition-colors"
                      title="Minimizar painel"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Vehicle Selector row */}
                <div className="w-full flex flex-col gap-2 border-t border-outline-variant/20 pt-2">
                  <label className="font-mono text-[9px] text-outline uppercase font-bold text-left">
                    Selecione o Meio de Transporte:
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      { id: 'walking', label: '🚶', text: 'Caminhar' },
                      { id: 'bike', label: '🚲', text: 'Pedalar' },
                      { id: 'moto', label: '🏍️', text: 'Moto' },
                      { id: 'car', label: '🚗', text: 'Carro' },
                    ].map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setTestVehicle(v.id as any);
                          let speedVal = 40;
                          if (v.id === 'walking') speedVal = 5;
                          else if (v.id === 'bike') speedVal = 15;
                          else if (v.id === 'moto') speedVal = 35;
                          else if (v.id === 'car') speedVal = 40;
                          setTestSpeedKmh(speedVal);
                          triggerNotification(`Velocidade de simulação ajustada.`, 'info');
                        }}
                        className={`py-1 px-1.5 rounded border text-center flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
                          testVehicle === v.id
                            ? 'bg-primary-container/10 border-[#00ff41] text-[#00ff41]'
                            : 'bg-surface-container-high border-outline-variant text-on-surface hover:border-outline hover:bg-surface-bright/10'
                        }`}
                        title={v.text}
                      >
                        <span className="text-sm">{v.label}</span>
                        <span className="font-mono text-[8px] uppercase tracking-tighter">{v.id}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between w-full border-t border-outline-variant/20 pt-2.5">
                  <span className="font-mono text-[10px] text-[#00ff41] bg-[#00ff41]/10 border border-[#00ff41]/20 px-2 py-0.5 rounded uppercase whitespace-nowrap">
                    {testVehicle === 'walking' && 'Pedestre (5 km/h)'}
                    {testVehicle === 'bike' && 'Bike (15 km/h)'}
                    {testVehicle === 'moto' && 'Moto (35 km/h)'}
                    {testVehicle === 'car' && 'Carro (40 km/h)'}
                  </span>
                  
                  <div className="flex items-center gap-1.5">
                    {isTestMode ? (
                      <button
                        onClick={() => {
                          setIsTestMode(false);
                          setIsConfiguringTestMode(false);
                          setScreen('squad-setup');
                          setShowIdentityStep(false);
                          if (animationIntervalRef.current) {
                            clearInterval(animationIntervalRef.current);
                            animationIntervalRef.current = null;
                          }
                          setUserCoords({
                            lat: -23.547,
                            lng: -46.63,
                            speed: 0,
                            heading: 0
                          });
                          setUserTrail([]);
                          triggerNotification('Retornou ao menu de conexões.', 'info');
                        }}
                        className="font-mono text-[10px] text-error bg-error/10 hover:bg-error/25 border border-error/20 px-2.5 py-1 rounded transition-all cursor-pointer font-bold uppercase active:scale-95 whitespace-nowrap"
                      >
                        Sair do Teste
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setUseGPSReal(true);
                          requestLocationPermission();
                        }}
                        className="font-mono text-[10px] text-primary-container bg-primary-container/10 hover:bg-primary-container/20 border border-primary-container/30 px-2.5 py-1 rounded transition-all cursor-pointer font-bold uppercase active:scale-95 whitespace-nowrap animate-pulse"
                      >
                        Ativar GPS Real 📡
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          )}



          {/* Float Vertical Map Controls Bar */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2 glass-panel rounded-full flex flex-col gap-2 p-1.5 z-30 shadow-2xl">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setUseGPSReal(!useGPSReal);
              }}
              title={useGPSReal ? "Desativar GPS" : "Ativar GPS real"}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${useGPSReal ? 'bg-primary-container text-on-primary-container' : 'text-on-surface hover:text-primary-container hover:bg-surface-bright/20'}`}
            >
              <Compass className="w-5 h-5" />
            </button>
            <div className="w-6 h-[1px] bg-outline-variant/40 mx-auto"></div>
            
            {/* Tactical Trail Toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowTrail(!showTrail);
                triggerNotification(!showTrail ? 'Exibição do traçado ativada.' : 'Exibição do traçado desativada.', 'info');
              }}
              title={showTrail ? "Ocultar Traçado" : "Exibir Traçado"}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${showTrail ? 'bg-primary-container text-on-primary-container' : 'text-on-surface hover:text-primary-container hover:bg-surface-bright/20'}`}
            >
              <History className="w-5 h-5" />
            </button>
            <div className="w-6 h-[1px] bg-outline-variant/40 mx-auto"></div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                triggerManualCheckIn();
              }}
              title="Emitir check-in"
              className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface hover:text-primary-container hover:bg-surface-bright/20 transition-all"
            >
              <Plus className="w-5 h-5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSimulationActive(!simulationActive);
                triggerNotification(simulationActive ? 'Simulação de squad pausada.' : 'Simulação de squad ativa.', 'info');
              }}
              title={simulationActive ? "Pausar simulação" : "Retomar simulação"}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${!simulationActive ? 'text-secondary' : 'text-on-surface hover:text-primary-container hover:bg-surface-bright/20'}`}
            >
              <Radio className="w-5 h-5" />
            </button>
          </div>

          {/* Bottom warning banner */}
          <div className="absolute bottom-24 sm:bottom-28 left-1/2 -translate-x-1/2 z-30 max-w-[90%] pointer-events-none">
            <div className="glass-panel rounded-full px-3 py-1 flex items-center gap-1.5 font-mono text-[9px] sm:text-[10px] text-on-surface-variant pointer-events-auto shadow-md">
              <Info className="w-3.5 h-3.5 text-secondary shrink-0" />
              <span>Localização em tempo real ativa apenas com sinal aberto.</span>
            </div>
          </div>

          {/* Telemetry bottom list card panel */}
          <div className="absolute bottom-0 left-0 right-0 z-40 flex flex-col items-center pointer-events-none px-4">
            <div className="w-full max-w-lg glass-panel rounded-t-2xl p-4 pointer-events-auto flex flex-col gap-3 shadow-[0_-10px_30px_rgba(0,0,0,0.5)] transition-all duration-300">
              
              {/* Drag Handle & Toggle Click area */}
              <div 
                onClick={() => setIsTelemetryMinimized(!isTelemetryMinimized)}
                className="w-full flex flex-col items-center cursor-pointer select-none group"
                title={isTelemetryMinimized ? "Clique para expandir o painel" : "Clique para minimizar o painel"}
              >
                <div className="w-12 h-1 bg-outline-variant group-hover:bg-primary-container rounded-full mx-auto mb-1 transition-colors"></div>
                {isTelemetryMinimized && (
                  <div className="flex items-center justify-between w-full mt-1 px-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#00ff41] animate-pulse"></span>
                      <span className="font-mono text-[10px] text-on-surface font-bold tracking-wider uppercase">PAINEL OPERACIONAL MINIMIZADO</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-mono text-[10px] text-primary-container font-bold bg-primary-container/10 px-2 py-0.5 rounded border border-primary-container/20 hover:bg-primary-container/20 transition-all">
                      <span>{teammates.filter(t => t.status !== 'offline').length + 1} ATIVOS</span>
                      <ChevronUp className="w-3.5 h-3.5" />
                    </div>
                  </div>
                )}
              </div>

              {!isTelemetryMinimized ? (
                <>
                  {/* Dynamic list rendering depending on navigation tab */}
                  {activeTab === 'map' && (
                    <>
                      <div className="flex justify-between items-center border-b border-outline-variant/30 pb-2">
                        <h2 className="font-mono text-xs text-on-surface tracking-wider font-bold">TELEMETRIA DO ESQUADRÃO</h2>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-primary-container font-bold uppercase tracking-widest">
                            {teammates.filter(t => t.status !== 'offline').length + 1} Ativos
                          </span>
                          <button
                            onClick={() => setIsTelemetryMinimized(true)}
                            className="text-on-surface-variant hover:text-on-surface p-1 rounded hover:bg-surface-bright/10 transition-colors"
                            title="Minimizar painel"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                        {/* User telemetry item */}
                        <div className="flex items-center justify-between p-2 rounded-lg hover:bg-surface-bright/10 transition-colors border border-transparent hover:border-outline-variant/20">
                          <div className="flex items-center gap-3">
                            <div className={`relative w-8 h-8 rounded-full border-2 ${activeColorTheme.borderClass} flex items-center justify-center bg-surface-container`}>
                              <span className={`font-mono text-[10px] font-bold ${activeColorTheme.textClass}`}>{callsign.slice(0, 2).toUpperCase()}</span>
                              <div className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${activeColorTheme.borderClass} border-2 border-surface pulse-green`}></div>
                            </div>
                            <div className="flex flex-col">
                              <span className="font-sans text-sm text-on-surface font-semibold">{callsign} (Você)</span>
                              <span className="font-mono text-[9px] text-[#00ff41] tracking-widest uppercase font-bold">Live</span>
                            </div>
                          </div>
                          <div className="font-mono text-[10px] text-on-surface-variant flex flex-col items-end">
                            <span>Agora</span>
                            <span>{userCoords.lat.toFixed(4)}, {userCoords.lng.toFixed(4)}</span>
                          </div>
                        </div>

                        {/* Squad members */}
                        {teammates.map(member => {
                          const isFocused = selectedTeammate === member.id;
                          const distance = getDistanceKm(userCoords.lat, userCoords.lng, member.lat, member.lng);

                          return (
                            <div
                              key={member.id}
                              onClick={() => setSelectedTeammate(isFocused ? null : member.id)}
                              className={`flex items-center justify-between p-2 rounded-lg transition-colors cursor-pointer border ${isFocused ? 'bg-primary-container/5 border-primary-container/30' : 'border-transparent hover:bg-surface-bright/10'}`}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`relative w-8 h-8 rounded-full border-2 ${member.borderColor} flex items-center justify-center bg-surface-container`}>
                                  <span className="font-mono text-[10px] text-on-surface font-bold">{member.initials}</span>
                                  {member.status === 'live' && (
                                    <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary-container border-2 border-surface pulse-green"></div>
                                  )}
                                </div>
                                <div className="flex flex-col">
                                  <span className="font-sans text-sm text-on-surface font-semibold">{member.name}</span>
                                  <span className={`font-mono text-[9px] tracking-widest uppercase font-bold ${member.status === 'live' ? 'text-[#00ff41]' : member.status === 'check-in' ? 'text-secondary' : 'text-on-surface-variant'}`}>
                                    {member.lastSeenText}
                                  </span>
                                </div>
                              </div>
                              <div className="font-mono text-[10px] text-on-surface-variant flex flex-col items-end">
                                <span className="text-[#00ff41] font-bold">{distance.toFixed(1)} km</span>
                                <span>{member.speed} km/h</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {/* View 2: Squad summary details */}
                  {activeTab === 'squad' && (
                    <>
                      <div className="flex justify-between items-center border-b border-outline-variant/30 pb-2">
                        <h2 className="font-mono text-xs text-on-surface tracking-wider font-bold">STATUS DO GRUPO</h2>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-outline uppercase tracking-widest font-bold">Canal Codificado</span>
                          <button
                            onClick={() => setIsTelemetryMinimized(true)}
                            className="text-on-surface-variant hover:text-on-surface p-1 rounded hover:bg-surface-bright/10 transition-colors"
                            title="Minimizar painel"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-3 p-1">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-surface-container-low p-2.5 rounded-lg border border-outline-variant/30">
                            <span className="font-mono text-[9px] text-on-surface-variant block uppercase">Frequência Ping</span>
                            <span className="font-mono text-sm text-primary-container font-bold">10-15 Segundos</span>
                          </div>
                          <div className="bg-surface-container-low p-2.5 rounded-lg border border-outline-variant/30">
                            <span className="font-mono text-[9px] text-on-surface-variant block uppercase">Criptografia</span>
                            <span className="font-mono text-sm text-primary-container font-bold">AES-256 GCM</span>
                          </div>
                        </div>
                        <div className="text-center">
                          <p className="font-mono text-[10px] text-on-surface-variant/70 leading-relaxed">
                            Mantenha o rastro tático sincronizado com sua equipe para obter atualizações em tempo real no mapa operacional.
                          </p>
                        </div>
                      </div>
                    </>
                  )}

                  {/* View 3: Interactive Location check-in history */}
                  {activeTab === 'history' && (
                    <>
                      <div className="flex justify-between items-center border-b border-outline-variant/30 pb-2">
                        <h2 className="font-mono text-xs text-on-surface tracking-wider font-bold">HISTÓRICO DE LOGS</h2>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setLogs([{ id: String(Date.now()), time: new Date().toLocaleTimeString(), type: 'auto', lat: userCoords.lat, lng: userCoords.lng, note: 'Logs reiniciados.', callsign }])}
                            className="font-mono text-[9px] text-error hover:underline mr-2"
                          >
                            Limpar Logs
                          </button>
                          <button
                            onClick={() => setIsTelemetryMinimized(true)}
                            className="text-on-surface-variant hover:text-on-surface p-1 rounded hover:bg-surface-bright/10 transition-colors"
                            title="Minimizar painel"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                        {logs.map((log) => (
                          <div key={log.id} className="bg-surface-container-low p-2 rounded-lg border border-outline-variant/20 flex justify-between items-start">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[10px] text-primary-container font-bold">{log.time}</span>
                                <span className="font-mono text-[9px] text-outline bg-surface-container-high px-1.5 py-0.5 rounded uppercase font-bold">
                                  {log.type}
                                </span>
                              </div>
                              <span className="font-sans text-xs text-on-surface-variant mt-1">{log.note}</span>
                            </div>
                            <span className="font-mono text-[9px] text-outline font-bold">
                              [{log.lat.toFixed(4)}, {log.lng.toFixed(4)}]
                            </span>
                          </div>
                        ))}
                        {logs.length === 0 && (
                          <div className="text-center py-6">
                            <p className="font-mono text-xs text-on-surface-variant">Nenhum log gravado.</p>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* Navigation shell integrated inside bottom telemetry card */}
                  <nav className="flex justify-around items-center border-t border-outline-variant/20 pt-3 mt-1">
                    <button
                      onClick={() => setActiveTab('map')}
                      className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg transition-colors ${activeTab === 'map' ? 'text-primary-container bg-primary-container/10' : 'text-on-surface-variant hover:text-on-surface'}`}
                    >
                      <MapIcon className="w-5 h-5" />
                      <span className="font-mono text-[9px] font-bold uppercase tracking-wider">Painel</span>
                    </button>

                    <button
                      onClick={() => setActiveTab('squad')}
                      className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg transition-colors ${activeTab === 'squad' ? 'text-primary-container bg-primary-container/10' : 'text-on-surface-variant hover:text-on-surface'}`}
                    >
                      <Users className="w-5 h-5" />
                      <span className="font-mono text-[9px] font-bold uppercase tracking-wider">Esquadrão</span>
                    </button>

                    <button
                      onClick={() => setActiveTab('history')}
                      className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg transition-colors ${activeTab === 'history' ? 'text-primary-container bg-primary-container/10' : 'text-on-surface-variant hover:text-on-surface'}`}
                    >
                      <History className="w-5 h-5" />
                      <span className="font-mono text-[9px] font-bold uppercase tracking-wider">Histórico</span>
                    </button>
                  </nav>
                </>
              ) : null}

            </div>
          </div>
        </motion.div>
      )}

      {/* ============================================================================
          SCREEN 4: SETTINGS SCREEN
          ============================================================================ */}
      {screen === 'settings' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex-1 flex flex-col items-center justify-start pt-12 pb-32 px-4 relative"
        >
          {/* Header app bar */}
          <header className="fixed top-4 left-4 right-4 rounded-xl bg-surface/80 backdrop-blur-xl border border-outline-variant/30 shadow-md flex justify-between items-center px-4 h-16 w-[calc(100%-32px)] md:max-w-2xl mx-auto z-50">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-surface-container-high border border-outline-variant flex items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="Avatar Placeholder"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuADUGG5EsYjETVCkitdXHn7GVME5pgy7NVTt-Q7LJdOt0ZhaiOGGOBrCPLbxmbRlSLA4dF-kgyub0wnwwPdjgvkdP6p0AAlo6DIIZPskLj38-6XZNjchtrCkxaMxwIE-DHsEzkvzyh0TY-iBvl-jCvXwW7r7ylncuCi5t7po6iHlp28YG3wHY3MRRJc4RZCfHRfMLVAjce1r5kSPi3AInuvJq42KVYSpl3SgY7Nf3PhxcllegLPE6J7"
                  className="w-full h-full object-cover opacity-85"
                />
              </div>
              <span className="font-mono text-xs text-on-surface font-bold">{callsign}</span>
            </div>
            <div className="font-sans font-black tracking-tighter text-xl text-primary-container">
              RASTRO
            </div>
            <button
              onClick={() => setScreen('map')}
              className="text-primary-container hover:bg-surface-bright/20 transition-colors rounded-full p-2 active:scale-95 duration-200"
            >
              <Check className="w-5 h-5 text-primary-container" />
            </button>
          </header>

          {/* Main settings settings details */}
          <main className="w-full max-w-2xl mt-24 flex flex-col gap-6 z-10 relative">
            
            {/* Title page */}
            <div className="px-1">
              <h1 className="text-3xl font-bold tracking-tight text-on-surface mb-1">Configuração</h1>
              <p className="font-mono text-xs text-outline uppercase tracking-widest font-bold">
                Sys_Pref // User_Profile
              </p>
            </div>

            {/* Profile Identity section */}
            <section className="glass-panel rounded-2xl p-6 flex flex-col gap-5">
              <div className="flex items-center gap-2 border-b border-outline-variant/20 pb-3">
                <Terminal className="w-4 h-4 text-outline" />
                <h2 className="font-mono text-xs text-on-surface font-bold uppercase tracking-wider">
                  Status de Identidade
                </h2>
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[10px] text-outline uppercase font-bold" htmlFor="callsign">
                  Callsign [Nome de Exibição]
                </label>
                <input
                  id="callsign"
                  type="text"
                  value={callsign}
                  onChange={(e) => setCallsign(e.target.value.toUpperCase())}
                  placeholder="Seu indicativo"
                  className="bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 font-mono text-sm text-on-surface w-full transition-all focus:ring-1 focus:ring-primary-container focus:border-primary-container outline-none"
                />
              </div>

              {/* Marker Spectrum selector */}
              <div>
                <label className="font-mono text-[10px] text-outline block mb-3 uppercase font-bold">
                  Espectro de Cor do Marcador
                </label>
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
                  {COLOR_SPECTRUM.map((color) => (
                    <button
                      key={color.id}
                      onClick={() => {
                        setMarkerColor(color.id);
                        triggerNotification(`Cor do marcador alterada para ${color.name}.`, 'info');
                      }}
                      className="relative flex flex-col items-center justify-center p-1 rounded-full hover:scale-105 transition-all focus:outline-none"
                    >
                      <div
                        className="w-10 h-10 rounded-full border-2 transition-all"
                        style={{
                          backgroundColor: '#131313',
                          borderColor: color.hex,
                          boxShadow: markerColor === color.id ? `0 0 15px ${color.hex}` : 'none'
                        }}
                      ></div>
                      {markerColor === color.id && (
                        <div className="absolute w-2 h-2 rounded-full bg-[#131313] border" style={{ borderColor: color.hex }}></div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* System protocol section */}
            <section className="glass-panel rounded-2xl p-6 flex flex-col gap-5">
              <div className="flex items-center gap-2 border-b border-outline-variant/20 pb-3">
                <Radio className="w-4 h-4 text-outline" />
                <h2 className="font-mono text-xs text-on-surface font-bold uppercase tracking-wider">
                  Protocolos de Rede
                </h2>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/10 pb-4">
                <div>
                  <label className="font-sans text-sm text-on-surface font-semibold block" htmlFor="check-in-interval">
                    Intervalo de Check-in
                  </label>
                  <span className="font-mono text-[10px] text-outline">Frequência de ping ao canal central</span>
                </div>
                <div className="relative w-full sm:w-40">
                  <select
                    id="check-in-interval"
                    value={checkInInterval}
                    onChange={(e) => {
                      setCheckInInterval(e.target.value);
                      triggerNotification(`Intervalo de check-in definido para ${e.target.value} min.`, 'info');
                    }}
                    className="appearance-none bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 pr-8 font-mono text-xs text-primary-container w-full cursor-pointer outline-none focus:border-primary-container"
                  >
                    <option value="15">15 min</option>
                    <option value="20">20 min</option>
                    <option value="30">30 min</option>
                    <option value="60">60 min</option>
                  </select>
                  <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-outline pointer-events-none" />
                </div>
              </div>

              {/* OSRM Route Profile selector */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/10 pb-4 pt-2">
                <div>
                  <label className="font-sans text-sm text-on-surface font-semibold block" htmlFor="route-profile">
                    Perfil de Roteamento (OSRM)
                  </label>
                  <span className="font-mono text-[10px] text-outline">Deslocamento seguindo as vias reais</span>
                </div>
                <div className="relative w-full sm:w-40">
                  <select
                    id="route-profile"
                    value={routeProfile}
                    onChange={(e) => {
                      const profile = e.target.value as 'driving' | 'foot';
                      setRouteProfile(profile);
                      triggerNotification(`Perfil de roteamento definido para: ${profile === 'driving' ? 'Carro/Moto (driving)' : 'A pé (foot)'}.`, 'info');
                    }}
                    className="appearance-none bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 pr-8 font-mono text-xs text-primary-container w-full cursor-pointer outline-none focus:border-primary-container"
                  >
                    <option value="driving">Carro/Moto (driving)</option>
                    <option value="foot">A pé (foot)</option>
                  </select>
                  <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-outline pointer-events-none" />
                </div>
              </div>

              {/* Show Trail toggle */}
              <div className="flex items-center justify-between border-b border-outline-variant/10 pb-4 pt-2">
                <div>
                  <label className="font-sans text-sm text-on-surface font-semibold block" htmlFor="show-trail-toggle">
                    Exibir Traçado Tático
                  </label>
                  <span className="font-mono text-[10px] text-outline">Desenhar histórico de movimento no mapa operacional</span>
                </div>
                <button
                  id="show-trail-toggle"
                  onClick={() => {
                    setShowTrail(!showTrail);
                    triggerNotification(!showTrail ? 'Exibição do traçado ativada.' : 'Exibição do traçado desativada.', 'info');
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${showTrail ? 'bg-primary-container' : 'bg-surface-container-high'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-surface shadow ring-0 transition duration-200 ease-in-out ${showTrail ? 'translate-x-5' : 'translate-x-0'}`}></span>
                </button>
              </div>

              {/* Silent mode toggle */}
              <div className="flex items-center justify-between pt-2">
                <div>
                  <label className="font-sans text-sm text-on-surface font-semibold block" htmlFor="silent-mode">
                    Modo Silencioso
                  </label>
                  <span className="font-mono text-[10px] text-outline">Suprimir avisos de telemetria secundários</span>
                </div>
                <button
                  id="silent-mode"
                  onClick={() => {
                    setSilentMode(!silentMode);
                    triggerNotification(!silentMode ? 'Modo silencioso ativado.' : 'Modo silencioso desativado.', 'info');
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${silentMode ? 'bg-primary-container' : 'bg-surface-container-high'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-surface shadow ring-0 transition duration-200 ease-in-out ${silentMode ? 'translate-x-5' : 'translate-x-0'}`}></span>
                </button>
              </div>
            </section>

            {/* Logout/Terminate session button */}
            <section className="mt-2">
              <button
                onClick={() => {
                  triggerNotification('Você saiu do esquadrão.', 'info');
                  localStorage.removeItem('rastro_squad_id');
                  localStorage.removeItem('rastro_callsign');
                  setSquadId('');
                  setCallsign('OPERADOR');
                  setTeammates([]);
                  setShowIdentityStep(false);
                  setScreen('squad-setup');
                }}
                className="w-full py-4 rounded-xl border border-error/30 bg-error-container/10 hover:bg-error-container/20 text-error font-mono text-xs uppercase tracking-wider font-bold transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                <LogOut className="w-4 h-4 text-error" />
                Sair do Esquadrão
              </button>
            </section>
          </main>
         </motion.div>
       )}

      {/* Location Help Modal / Assistant */}
      <AnimatePresence>
        {showLocationHelpModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/85 backdrop-blur-md z-[200] flex items-center justify-center p-4 overflow-y-auto"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-[#121212] border border-[#00e639]/30 rounded-2xl p-6 md:p-8 max-w-lg w-full shadow-[0_0_50px_rgba(0,255,65,0.2)] relative overflow-hidden"
            >
              <div className="relative z-10 flex flex-col gap-5">
                {/* Header */}
                <div className="flex items-center gap-3 border-b border-outline-variant/20 pb-4">
                  <div className="bg-error/10 p-2.5 rounded-lg border border-error/30 text-error animate-pulse">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-sans font-extrabold text-lg text-on-surface uppercase tracking-wider">
                      Localização Requerida
                    </h2>
                    <span className="font-mono text-[10px] text-outline uppercase font-black">Código de Erro: PERMISSION_DENIED</span>
                  </div>
                </div>

                {/* Subtext */}
                <p className="font-sans text-sm text-on-surface-variant leading-relaxed">
                  O <strong>Rastro</strong> precisa de acesso à localização para atualizar sua posição automaticamente. Se o seu dispositivo ou navegador bloqueou o GPS, <strong>não se preocupe! Você ainda pode entrar no esquadrão real</strong> normalmente com sua equipe usando um <strong>GPS Virtual</strong> (você poderá clicar no mapa para simular sua movimentação pelas ruas em tempo real).
                </p>

                {/* Tab Navigation */}
                <div className="flex bg-surface-container-low border border-outline-variant/20 rounded-xl p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveHelpTab('apk')}
                    className={`flex-1 py-2 rounded-lg font-mono text-[10px] sm:text-[11px] font-bold uppercase transition-all ${
                      activeHelpTab === 'apk'
                        ? 'bg-[#00ff41] text-[#121212] shadow-sm shadow-[#00ff41]/20'
                        : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-bright/10'
                    }`}
                  >
                    No Aplicativo (APK)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveHelpTab('android')}
                    className={`flex-1 py-2 rounded-lg font-mono text-[10px] sm:text-[11px] font-bold uppercase transition-all ${
                      activeHelpTab === 'android'
                        ? 'bg-[#00ff41] text-[#121212] shadow-sm shadow-[#00ff41]/20'
                        : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-bright/10'
                    }`}
                  >
                    No Chrome (Android)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveHelpTab('ios')}
                    className={`flex-1 py-2 rounded-lg font-mono text-[10px] sm:text-[11px] font-bold uppercase transition-all ${
                      activeHelpTab === 'ios'
                        ? 'bg-[#00ff41] text-[#121212] shadow-sm shadow-[#00ff41]/20'
                        : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-bright/10'
                    }`}
                  >
                    No Safari (iPhone)
                  </button>
                </div>

                {/* Guide Sections */}
                <div className="flex flex-col gap-4 my-2">
                  {activeHelpTab === 'apk' && (
                    <div className="bg-surface-container-low/80 border border-outline-variant/30 rounded-xl p-4 flex flex-col gap-2">
                      <div className="flex items-center gap-2 border-b border-outline-variant/10 pb-2">
                        <span className="w-2 h-2 rounded-full bg-[#00ff41] shadow-[0_0_8px_#00ff41]"></span>
                        <h4 className="font-mono text-xs font-bold text-on-surface uppercase">No Aplicativo instalado (APK)</h4>
                      </div>
                      <ol className="font-mono text-[11px] text-on-surface-variant list-decimal list-inside space-y-1.5 leading-normal">
                        <li>Abra as <strong className="text-on-surface">Configurações</strong> do seu celular Android.</li>
                        <li>Vá em <strong className="text-on-surface">Aplicativos</strong> ou <strong className="text-on-surface">Apps</strong> e busque por <strong className="text-on-surface">Rastro</strong>.</li>
                        <li>Toque em <strong className="text-on-surface">Permissões</strong> ➔ <strong className="text-on-surface">Localização</strong>.</li>
                        <li>Selecione <strong className="text-on-surface">Permitir durante o uso do app</strong> ou <strong className="text-on-surface">Permitir o tempo todo</strong>.</li>
                        <li>Certifique-se de ativar a opção de <strong className="text-on-surface">Usar localização precisa</strong>.</li>
                        <li>Reinicie o aplicativo Rastro completamente.</li>
                        <li>Se o seu aparelho ou APK não tiver suporte nativo a GPS, clique no botão <strong className="text-[#00ff41]">Entrar com GPS Virtual</strong> abaixo para prosseguir e se posicionar livremente clicando no mapa!</li>
                      </ol>
                    </div>
                  )}

                  {activeHelpTab === 'android' && (
                    <div className="bg-surface-container-low/80 border border-outline-variant/30 rounded-xl p-4 flex flex-col gap-2">
                      <div className="flex items-center gap-2 border-b border-outline-variant/10 pb-2">
                        <span className="w-2 h-2 rounded-full bg-[#00ff41] shadow-[0_0_8px_#00ff41]"></span>
                        <h4 className="font-mono text-xs font-bold text-on-surface uppercase">No Android (Google Chrome)</h4>
                      </div>
                      <ol className="font-mono text-[11px] text-on-surface-variant list-decimal list-inside space-y-1.5 leading-normal">
                        <li>Toque no ícone de <strong className="text-on-surface">cadeado</strong> ou <strong className="text-on-surface">configurações</strong> à esquerda do endereço do site.</li>
                        <li>Toque em <strong className="text-on-surface">Permissões</strong>.</li>
                        <li>Ative a opção de <strong className="text-on-surface">Localização</strong> (mude para &apos;Permitir&apos;).</li>
                        <li>Recarregue a página do aplicativo.</li>
                      </ol>
                    </div>
                  )}

                  {activeHelpTab === 'ios' && (
                    <div className="bg-surface-container-low/80 border border-outline-variant/30 rounded-xl p-4 flex flex-col gap-2">
                      <div className="flex items-center gap-2 border-b border-outline-variant/10 pb-2">
                        <span className="w-2 h-2 rounded-full bg-[#00ff41] shadow-[0_0_8px_#00ff41]"></span>
                        <h4 className="font-mono text-xs font-bold text-on-surface uppercase">No iPhone/iOS (Safari)</h4>
                      </div>
                      <ol className="font-mono text-[11px] text-on-surface-variant list-decimal list-inside space-y-1.5 leading-normal">
                        <li>Toque no ícone <strong className="text-on-surface">&apos;aA&apos;</strong> na barra de endereços (lado esquerdo).</li>
                        <li>Selecione <strong className="text-on-surface">Ajustes do Site</strong>.</li>
                        <li>Em <strong className="text-on-surface">Localização</strong>, selecione <strong className="text-on-surface">Permitir</strong>.</li>
                        <li>Se não funcionar, vá nos <strong className="text-on-surface">Ajustes do iPhone</strong> ➔ <strong className="text-on-surface">Privacidade</strong> ➔ <strong className="text-on-surface">Serviços de Localização</strong> e certifique-se de que o Safari tem acesso ao usar.</li>
                      </ol>
                    </div>
                  )}
                </div>

                {/* Footer buttons */}
                <div className="flex flex-col sm:flex-row gap-2 mt-2">
                  <button
                    onClick={() => {
                      setShowLocationHelpModal(false);
                      requestLocationPermission();
                    }}
                    className="flex-1 bg-[#00e639] text-on-primary-container font-mono text-xs uppercase tracking-wider font-extrabold py-3.5 px-4 rounded-xl shadow-[0_0_20px_rgba(0,255,65,0.2)] active:scale-[0.98] transition-all flex items-center justify-center gap-2 hover:bg-[#00ff41]"
                  >
                    <RotateCw className="w-4 h-4 animate-spin-slow" />
                    Tentar Novamente (GPS Real)
                  </button>
                  <button
                    onClick={() => {
                      setShowLocationHelpModal(false);
                      setUseGPSReal(false);
                      triggerNotification('Conectado usando GPS Virtual. Clique no mapa para simular deslocamento!', 'success');
                    }}
                    className="flex-1 bg-surface-container-high hover:bg-surface-bright/20 border border-[#00ff41]/50 text-[#00ff41] font-mono text-xs uppercase tracking-wider font-extrabold py-3.5 px-4 rounded-xl active:scale-[0.98] transition-all shadow-[0_0_15px_rgba(0,255,65,0.05)]"
                  >
                    Entrar com GPS Virtual
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
 
     </div>
    
  );
}
