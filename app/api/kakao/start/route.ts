import { NextResponse } from 'next/server';
import { buildKakaoAuthUrl } from '@/lib/kakao';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const label = (searchParams.get('label') || '').trim();

  if (!label) {
    return NextResponse.json({ error: '이름(label)이 필요해요.' }, { status: 400 });
  }

  return NextResponse.redirect(buildKakaoAuthUrl(label));
}
