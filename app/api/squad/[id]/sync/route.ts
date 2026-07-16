import { NextRequest, NextResponse } from 'next/server';
import { getSquad, saveSquad, Teammate } from '@/lib/squadDb';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, lat, lng, speed, status, color, borderColor, trail } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Nome inválido para sincronização' }, { status: 400 });
    }

    const squad = await getSquad(id);
    if (!squad) {
      return NextResponse.json({ error: 'Esquadrão não encontrado' }, { status: 404 });
    }

    const now = new Date();
    const cleanName = name.trim().toUpperCase();

    // Find if user already exists in squad (by name or id)
    const existingIndex = squad.members.findIndex(
      m => m.name.trim().toUpperCase() === cleanName && !m.isSimulated
    );

    const initials = cleanName.slice(0, 2).toUpperCase();

    const userTelemetry: Teammate = {
      id: cleanName,
      name: name.trim(),
      initials,
      lat: Number(lat) || -23.547,
      lng: Number(lng) || -46.63,
      speed: Number(speed) || 0,
      status: status || 'live',
      lastSeenTime: now.toISOString(),
      lastSeenText: status === 'live' ? 'Live' : status === 'check-in' ? 'Check-in recente' : 'Offline',
      color: color || 'text-[#00ff41]',
      borderColor: borderColor || 'border-[#00ff41]',
      trail: Array.isArray(trail) ? trail : [],
      isSimulated: false,
    };

    if (existingIndex !== -1) {
      squad.members[existingIndex] = userTelemetry;
    } else {
      squad.members.push(userTelemetry);
    }

    // Save updated squad state
    await saveSquad(squad);

    return NextResponse.json({
      success: true,
      members: squad.members,
      logs: squad.logs,
    });
  } catch (error) {
    console.error('Error syncing telemetry:', error);
    return NextResponse.json({ error: 'Falha na sincronização de telemetria' }, { status: 500 });
  }
}
