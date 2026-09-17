'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { generateDetailSectionImage, resizeForCoupang } from '@/lib/imageProcessing';

const BUCKET = 'detail-images';
const PATH = '/dashboard/sales/detail-pages';

function extFromContentType(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
}

export async function createProject(
  title: string
): Promise<{ error: string } | { success: true; id: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('detail_page_projects')
    .insert({ title: title.trim() || null, author_email: user?.email })
    .select('id')
    .single();

  if (error || !data) return { error: error?.message || '프로젝트 생성에 실패했어요.' };
  revalidatePath(PATH);
  return { success: true, id: (data as { id: string }).id };
}

export async function deleteProject(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('detail_page_projects').delete().eq('id', id);
  if (error) console.error('[detail-pages] deleteProject 실패:', error.message);
  revalidatePath(PATH);
}

// 섹션 하나 추가 - 이미지(선택)+문구를 받아서 즉시 AI 생성까지 실행한다.
// 실패해도 행은 남겨서(error 컬럼에 메시지 저장) 나중에 재시도할 수
// 있게 한다.
export async function addSection(
  projectId: string,
  position: number,
  formData: FormData
): Promise<{ error: string } | { success: true; url: string }> {
  const supabase = createClient();
  const promptText = String(formData.get('text') || '').trim();
  if (!promptText) return { error: '문구(키워드/분위기/설명)를 입력해주세요.' };

  const file = formData.get('image') as File | null;
  let inputImageUrl: string | null = null;
  let productImage: { buffer: Buffer; mimeType: string } | null = null;
  const sectionId = randomUUID();

  if (file && file.size > 0) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'image/jpeg';
    productImage = { buffer, mimeType };
    const path = `detail-pages/${projectId}/${sectionId}-input.${extFromContentType(mimeType)}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: mimeType,
      upsert: true,
    });
    if (upErr) return { error: upErr.message };
    inputImageUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  const { error: insertErr } = await supabase.from('detail_page_sections').insert({
    id: sectionId,
    project_id: projectId,
    position,
    input_image_url: inputImageUrl,
    prompt_text: promptText,
  });
  if (insertErr) return { error: insertErr.message };

  return runGeneration(supabase, sectionId, projectId, promptText, productImage);
}

export async function retrySection(
  sectionId: string
): Promise<{ error: string } | { success: true; url: string }> {
  const supabase = createClient();
  const { data: section, error } = await supabase
    .from('detail_page_sections')
    .select('*')
    .eq('id', sectionId)
    .single();
  if (error || !section) return { error: error?.message || '섹션을 찾을 수 없어요.' };

  let productImage: { buffer: Buffer; mimeType: string } | null = null;
  if (section.input_image_url) {
    const res = await fetch(section.input_image_url);
    if (!res.ok) return { error: `원본 이미지를 다시 불러오지 못했어요 (HTTP ${res.status})` };
    const buffer = Buffer.from(await res.arrayBuffer());
    productImage = { buffer, mimeType: res.headers.get('content-type') || 'image/jpeg' };
  }

  return runGeneration(supabase, sectionId, section.project_id, section.prompt_text, productImage);
}

async function runGeneration(
  supabase: ReturnType<typeof createClient>,
  sectionId: string,
  projectId: string,
  promptText: string,
  productImage: { buffer: Buffer; mimeType: string } | null
): Promise<{ error: string } | { success: true; url: string }> {
  try {
    const generated = await generateDetailSectionImage(promptText, productImage);
    const resized = await resizeForCoupang(generated);
    const outPath = `detail-pages/${projectId}/${sectionId}-output.jpg`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(outPath, resized, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (upErr) throw new Error(upErr.message);
    const outputUrl = supabase.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl;

    const { error: updateErr } = await supabase
      .from('detail_page_sections')
      .update({ output_image_url: outputUrl, error: null })
      .eq('id', sectionId);
    if (updateErr) return { error: updateErr.message };

    revalidatePath(PATH);
    return { success: true, url: outputUrl };
  } catch (e: any) {
    const message = e?.message || String(e);
    await supabase.from('detail_page_sections').update({ error: message }).eq('id', sectionId);
    revalidatePath(PATH);
    return { error: message };
  }
}

export async function deleteSection(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('detail_page_sections').delete().eq('id', id);
  if (error) console.error('[detail-pages] deleteSection 실패:', error.message);
  revalidatePath(PATH);
}
