'use server';

import {
  translateToChineseForSourcing,
  translateToKoreanForSourcing,
  type SourcingZhTranslation,
} from '@/lib/ai';

export async function runTranslateToChinese(
  text: string
): Promise<{ error: string } | { success: true; data: SourcingZhTranslation }> {
  if (!text.trim()) return { error: '번역할 한국어 문장을 입력해주세요.' };
  try {
    const data = await translateToChineseForSourcing(text.trim());
    return { success: true, data };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export async function runTranslateToKorean(
  text: string
): Promise<{ error: string } | { success: true; translation: string }> {
  if (!text.trim()) return { error: '번역할 중국어 문장을 입력해주세요.' };
  try {
    const translation = await translateToKoreanForSourcing(text.trim());
    return { success: true, translation };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}
