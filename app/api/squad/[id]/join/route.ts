import { NextRequest, NextResponse } from 'next/server';
import { getSquad } from '@/lib/squadDb';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const name = body?.name;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Nome inválido' }, { status: 400 });
    }

    const squad = await getSquad(id);
    if (!squad) {
      return NextResponse.json({ error: 'Esquadrão não encontrado ou inválido' }, { status: 404 });
    }

    const cleanName = name.trim().toUpperCase();
    
    // Check if the name matches any active squad member
    const existingMember = squad.members.find(
      m => m.name.trim().toUpperCase() === cleanName
    );

    if (existingMember && existingMember.status !== 'offline') {
      return NextResponse.json(
        { error: 'Este nome já está ativo neste esquadrão.' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error joining squad:', error);
    return NextResponse.json({ error: 'Erro ao validar entrada no esquadrão' }, { status: 500 });
  }
}
