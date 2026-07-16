import { NextRequest, NextResponse } from 'next/server';
import { getSquad } from '@/lib/squadDb';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const squad = await getSquad(id);
    if (!squad) {
      return NextResponse.json({ error: 'Esquadrão não encontrado' }, { status: 404 });
    }
    return NextResponse.json(squad);
  } catch (error) {
    console.error('Error fetching squad:', error);
    return NextResponse.json({ error: 'Falha ao buscar esquadrão' }, { status: 500 });
  }
}
