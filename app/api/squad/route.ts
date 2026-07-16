import { NextResponse } from 'next/server';
import { createSquad } from '@/lib/squadDb';

export async function POST() {
  try {
    const newSquad = await createSquad();
    return NextResponse.json(newSquad);
  } catch (error) {
    console.error('Error creating squad:', error);
    return NextResponse.json({ error: 'Falha ao criar esquadrão' }, { status: 500 });
  }
}
