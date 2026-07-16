import { NextRequest, NextResponse } from 'next/server';
import { getSquad, saveSquad, LogEntry } from '@/lib/squadDb';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action, log } = body;

    const squad = await getSquad(id);
    if (!squad) {
      return NextResponse.json({ error: 'Esquadrão não encontrado' }, { status: 404 });
    }

    if (action === 'clear') {
      const now = new Date();
      squad.logs = [
        {
          id: String(Date.now()),
          time: now.toLocaleTimeString('pt-BR', { hour12: false }),
          type: 'auto',
          lat: squad.members[0]?.lat || -23.547,
          lng: squad.members[0]?.lng || -46.63,
          note: 'Histórico de logs reiniciado pela equipe.',
          callsign: body.callsign || 'SYS'
        }
      ];
    } else if (action === 'add' && log) {
      // Ensure it has a unique id and properly formatted data
      const newLog: LogEntry = {
        id: log.id || String(Date.now()),
        time: log.time || new Date().toLocaleTimeString('pt-BR', { hour12: false }),
        type: log.type || 'auto',
        lat: Number(log.lat) || -23.547,
        lng: Number(log.lng) || -46.63,
        note: log.note || '',
        callsign: log.callsign || 'ANON'
      };

      // Keep only last 50 logs to prevent file bloat
      squad.logs = [newLog, ...squad.logs].slice(0, 50);
    } else {
      return NextResponse.json({ error: 'Ação ou dados inválidos' }, { status: 400 });
    }

    await saveSquad(squad);

    return NextResponse.json({
      success: true,
      logs: squad.logs
    });
  } catch (error) {
    console.error('Error handling squad logs:', error);
    return NextResponse.json({ error: 'Falha ao processar logs do esquadrão' }, { status: 500 });
  }
}
