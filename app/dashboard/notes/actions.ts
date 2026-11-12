'use server';

import type { JSONContent } from '@tiptap/core';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendPushToEmail } from '@/lib/webpush';
import { NOTE_BODY_CHAR_LIMIT } from '@/lib/notes/editorExtensions';

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] };

// 제목 길이 한도 - DB(work_notes_title_length check 제약)와 반드시 맞춰야
// 한다.
const NOTE_TITLE_CHAR_LIMIT = 300;

function notesPath(id?: string) {
  return id ? `/dashboard/notes/${id}` : '/dashboard/notes';
}

type AllowedUser = { id: string; email: string };

// 모든 Server Action의 맨 앞에서 호출하는 공통 가드. RLS(allowed_users
// 검사)가 막아주더라도 애플리케이션 레벨에서도 이중으로 막는다 - RLS는
// "DB에 어떤 행이 보이는지/바뀌는지"만 막아주고, 이 가드는 "허용 안 된
// 계정이면 아예 로직을 타지 않게" 해서 의도를 명확히 하고 실수로 RLS를
// 우회하는 쿼리(예: service role 클라이언트 오용)가 생겨도 한 번 더
// 걸러준다.
async function getAllowedUser(
  supabase: ReturnType<typeof createClient>
): Promise<{ user: AllowedUser } | { error: string; retryable?: boolean }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { error: '로그인이 필요해요.', retryable: false };

  const { data: allowed, error } = await supabase
    .from('allowed_users')
    .select('email')
    .eq('email', user.email)
    .maybeSingle();
  if (error) {
    // DB 조회 자체가 실패한 일시적 오류 - 입력을 고쳐야 하는 종류가
    // 아니므로 재시도하면 성공할 수 있다(retryable 기본값 true로 둠).
    console.error('[work notes] 접근 권한 확인 실패:', error.message);
    return { error: '접근 권한을 확인하지 못했어요. 잠시 후 다시 시도해주세요.' };
  }
  if (!allowed) return { error: '접근 권한이 없어요.', retryable: false };

  return { user: { id: user.id, email: user.email } };
}

export type NotePermission = 'owner' | 'edit' | 'view';

export type NoteListItem = {
  id: string;
  title: string;
  updatedAt: string;
  updatedByEmail: string | null;
};

export type SharedNoteListItem = NoteListItem & {
  ownerEmail: string;
  permission: 'view' | 'edit';
};

export type NoteDetail = {
  id: string;
  title: string;
  body: JSONContent;
  rev: number;
  updatedAt: string;
  updatedByEmail: string | null;
  ownerEmail: string;
  permission: NotePermission;
};

export type NoteHistoryListItem = {
  id: string;
  rev: number;
  title: string;
  editedByEmail: string | null;
  editedAt: string;
};

export type NoteHistoryDetail = NoteHistoryListItem & { body: JSONContent };

// 빈 노트를 만들고 바로 history에도 첫 revision(rev=1)을 남긴다. 히스토리
// 기록이 실패해도(드문 경우) 노트 자체는 이미 만들어졌으니 에러로 막지
// 않고 로그만 남긴다 - 사용자 입장에서 "새 노트" 버튼이 먹통이 되는 것보다
// 나음.
export async function createNote(): Promise<{ id: string } | { error: string }> {
  const supabase = createClient();
  const guard = await getAllowedUser(supabase);
  if ('error' in guard) return { error: guard.error };
  const { user } = guard;

  const { data, error } = await supabase
    .from('work_notes')
    .insert({ owner_id: user.id, owner_email: user.email })
    .select('id, title, body, rev')
    .single();
  if (error || !data) {
    return { error: '새 노트를 만들지 못했어요. 잠시 후 다시 시도해주세요.' };
  }

  const { error: historyError } = await supabase.from('work_note_history').insert({
    note_id: data.id,
    rev: data.rev,
    title: data.title,
    body: data.body,
    edited_by: user.id,
    edited_by_email: user.email,
  });
  if (historyError) {
    console.error('[work notes] 생성 이력 기록 실패:', historyError.message);
  }

  revalidatePath(notesPath());
  return { id: data.id };
}

export async function getMyNotes(): Promise<{ notes: NoteListItem[]; error: string | null }> {
  const supabase = createClient();
  const guard = await getAllowedUser(supabase);
  if ('error' in guard) return { notes: [], error: guard.error };
  const { user } = guard;

  const { data, error } = await supabase
    .from('work_notes')
    .select('id, title, updated_at, updated_by_email')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false });
  if (error) {
    console.error('[work notes] 내 수첩 목록 조회 실패:', error.message);
    return { notes: [], error: '내 수첩 목록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.' };
  }

  return {
    notes: (data ?? []).map((n) => ({
      id: n.id,
      title: n.title,
      updatedAt: n.updated_at,
      updatedByEmail: n.updated_by_email,
    })),
    error: null,
  };
}

// 공유받은 노트 목록은 두 단계로 조회한다(공유행 → id 배치 조회) - 노트
// 하나씩 따로 조회하면 공유받은 노트 수만큼 쿼리가 늘어나는 N+1이 된다.
export async function getSharedWithMeNotes(): Promise<{
  notes: SharedNoteListItem[];
  error: string | null;
}> {
  const supabase = createClient();
  const guard = await getAllowedUser(supabase);
  if ('error' in guard) return { notes: [], error: guard.error };
  const { user } = guard;

  const { data: shares, error: sharesError } = await supabase
    .from('work_note_shares')
    .select('note_id, permission')
    .eq('target_user_id', user.id);
  if (sharesError) {
    console.error('[work notes] 공유받은 목록 조회 실패:', sharesError.message);
    return { notes: [], error: '공유받은 수첩을 불러오지 못했어요. 잠시 후 다시 시도해주세요.' };
  }
  if (!shares || shares.length === 0) return { notes: [], error: null };

  const noteIds = shares.map((s) => s.note_id);
  const { data: notes, error: notesError } = await supabase
    .from('work_notes')
    .select('id, title, updated_at, updated_by_email, owner_email')
    .in('id', noteIds)
    .order('updated_at', { ascending: false });
  if (notesError) {
    console.error('[work notes] 공유받은 노트 조회 실패:', notesError.message);
    return { notes: [], error: '공유받은 수첩을 불러오지 못했어요. 잠시 후 다시 시도해주세요.' };
  }

  const permissionByNoteId = new Map(
    shares.map((s) => [s.note_id, s.permission as 'view' | 'edit'])
  );

  return {
    notes: (notes ?? []).map((n) => ({
      id: n.id,
      title: n.title,
      updatedAt: n.updated_at,
      updatedByEmail: n.updated_by_email,
      ownerEmail: n.owner_email,
      permission: permissionByNoteId.get(n.id) ?? 'view',
    })),
    error: null,
  };
}

// RLS가 접근 가능한 행만 돌려주므로, 행이 없으면 "원래 없음"과 "권한 없음"을
// 구분하지 않고 같은 안내를 보여준다 (둘 다 사용자가 할 수 있는 건 목록으로
// 돌아가는 것뿐이라 구분할 필요가 없음).
export async function getNote(id: string): Promise<{ note: NoteDetail } | { error: string }> {
  const supabase = createClient();
  const guard = await getAllowedUser(supabase);
  if ('error' in guard) return { error: guard.error };
  const { user } = guard;

  const { data, error } = await supabase
    .from('work_notes')
    .select('id, title, body, rev, updated_at, updated_by_email, owner_id, owner_email')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[work notes] 노트 조회 실패:', error.message);
    return { error: '이 노트를 불러오지 못했어요. 잠시 후 다시 시도해주세요.' };
  }
  if (!data) return { error: '이 노트를 더 이상 볼 수 없어요.' };

  let permission: NotePermission = 'view';
  if (data.owner_id === user.id) {
    permission = 'owner';
  } else {
    const { data: shareRow } = await supabase
      .from('work_note_shares')
      .select('permission')
      .eq('note_id', id)
      .eq('target_user_id', user.id)
      .maybeSingle();
    permission = shareRow?.permission === 'edit' ? 'edit' : 'view';
  }

  return {
    note: {
      id: data.id,
      title: data.title,
      body: (data.body as JSONContent) ?? EMPTY_DOC,
      rev: data.rev,
      updatedAt: data.updated_at,
      updatedByEmail: data.updated_by_email,
      ownerEmail: data.owner_email,
      permission,
    },
  };
}

export type SaveNoteSuccess = {
  ok: true;
  rev: number;
  updatedAt: string;
  conflictMessage: string | null;
};

// retryable=false는 "입력을 고치지 않는 한 다시 시도해도 절대 성공 못하는"
// 에러(제목/내용 길이 초과, 보기 전용, 노트 삭제됨 등)에만 붙인다. 이런
// 에러는 자동/수동 재시도를 걸어도 같은 이유로 또 실패하므로 클라이언트가
// 재시도를 걸지 않고 이 메시지를 그대로 보여줘야 한다. 생략(undefined)이면
// 일시적 오류(네트워크/DB)로 보고 재시도 가능하다고 간주한다.
export type SaveNoteError = { error: string; retryable?: boolean };

// 동시수정은 base_rev로 거절하지 않고 last-write-wins로 저장한 뒤 충돌
// 안내만 보여준다(이번 범위에서 409 거절은 제외하기로 함). conflict는
// "내가 보던 버전 이후 다른 사람이 먼저 고쳤는가"로 판정하고, 그 "다른
// 사람"이 나 자신(이전 자동저장)이면 충돌로 치지 않는다.
// rev 증가는 save_work_note RPC(Postgres 함수, 20261108013914 마이그레이션)
// 안에서 단일 UPDATE 문으로 원자적으로 처리한다 - "select rev → +1 계산
// → update"처럼 두 단계로 나누면 동시에 두 저장 요청이 겹칠 때 lost
// update(rev가 한 번만 올라가고 한쪽 내용이 사라짐)가 생길 수 있다.
// RPC가 "갱신 전 rev/작성자"도 같은 원자적 쿼리에서 같이 돌려주므로,
// 그 값으로 충돌 여부를 판정한다(= 더 이상 따로 조회하지 않음).
//
// RPC가 빈 결과(행 0개)를 돌려주면 "노트가 없음"과 "있지만 쓰기 권한
// 없음(보기 전용)"을 구분할 수 없어서(둘 다 UPDATE가 0행), 이때만 보조로
// select 한 번을 더 해서 어느 쪽인지 사용자에게 정확히 안내한다. 이
// 보조 조회는 rev 계산에 쓰이지 않으므로 레이스 컨디션과 무관하다.
export async function saveNote(
  id: string,
  baseRev: number,
  title: string,
  body: JSONContent
): Promise<SaveNoteSuccess | SaveNoteError> {
  const supabase = createClient();
  const guard = await getAllowedUser(supabase);
  if ('error' in guard) return { error: guard.error, retryable: guard.retryable };
  const { user } = guard;

  if (title.length > NOTE_TITLE_CHAR_LIMIT) {
    return {
      error: `제목이 너무 길어요(최대 ${NOTE_TITLE_CHAR_LIMIT}자). 줄이고 다시 저장해주세요.`,
      retryable: false,
    };
  }
  const bodyLength = JSON.stringify(body).length;
  if (bodyLength > NOTE_BODY_CHAR_LIMIT) {
    return {
      error: '내용이 너무 많아요(최대 50만 자). 일부를 줄이고 다시 저장해주세요.',
      retryable: false,
    };
  }

  const { data: rows, error: rpcError } = await supabase.rpc('save_work_note', {
    p_note_id: id,
    p_title: title,
    p_body: body,
    p_user_id: user.id,
    p_user_email: user.email,
  });

  if (rpcError) {
    console.error('[work notes] 저장 실패:', rpcError.message);
    return { error: '저장하지 못했어요. 잠시 후 다시 시도해주세요.' };
  }

  const result = rows?.[0];
  if (!result) {
    // 어느 쪽인지(없음/보기 전용) 구분하기 위한 보조 조회.
    const { data: existing } = await supabase
      .from('work_notes')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    return existing
      ? { error: '보기 전용 노트라 저장할 수 없어요.', retryable: false }
      : { error: '이 노트를 더 이상 볼 수 없어요.', retryable: false };
  }

  const conflict = result.prev_rev !== baseRev && result.prev_updated_by_email !== user.email;

  revalidatePath(notesPath());
  revalidatePath(notesPath(id));

  return {
    ok: true,
    rev: result.rev,
    updatedAt: result.updated_at,
    conflictMessage: conflict
      ? `${result.prev_updated_by_email ?? '다른 사람'}님이 방금 이 노트를 수정했어요. 지금 입력하신 내용으로 저장했고, 이전 내용은 '변경 이력'에서 볼 수 있어요.`
      : null,
  };
}

export async function deleteNote(id: string): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const guard = await getAllowedUser(supabase);
  if ('error' in guard) return { error: guard.error };

  const { data, error } = await supabase
    .from('work_notes')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[work notes] 삭제 실패:', error.message);
    return { error: '삭제하지 못했어요. 잠시 후 다시 시도해주세요.' };
  }
  // RLS(owner만 삭제 가능)에 걸리거나 이미 지워졌으면 0행.
  if (!data) return { error: '삭제 권한이 없거나 이미 삭제된 노트예요.' };

  revalidatePath(notesPath());
  return { success: true };
}

export async function getShareTargets(): Promise<{ emails: string[] } | { error: string }> {
  const supabase = createClient();
  const guard = await getAllowedUser(supabase);
  if ('error' in guard) return { error: guard.error };
  const { user } = guard;

  const { data, error } = await supabase
    .from('allowed_users')
    .select('email')
    .neq('email', user.email);
  if (error) {
    console.error('[work notes] 공유 대상 조회 실패:', error.message);
    return { error: '공유 대상 정보를 가져오지 못했어요. 잠시 후 다시 시도해주세요.' };
  }

  return { emails: (data ?? []).map((r) => r.email) };
}

// 현재 이 노트가 누구에게 어떤 권한으로 공유돼 있는지(ShareDialog가 토글
// 초기값으로 씀). work_note_shares SELECT 정책상 소유자만 전체를 볼 수
// 있다.
export async function getNoteShares(
  noteId: string
): Promise<{ shares: { email: string; permission: 'view' | 'edit' }[] } | { error: string }> {
  const supabase = createClient();
  const guard = await getAllowedUser(supabase);
  if ('error' in guard) return { error: guard.error };

  const { data, error } = await supabase
    .from('work_note_shares')
    .select('target_email, permission')
    .eq('note_id', noteId);
  if (error) {
    console.error('[work notes] 공유 설정 조회 실패:', error.message);
    return { error: '공유 설정을 가져오지 못했어요. 잠시 후 다시 시도해주세요.' };
  }

  return {
    shares: (data ?? []).map((s) => ({
      email: s.target_email,
      permission: s.permission as 'view' | 'edit',
    })),
  };
}

export type SetNoteShareSuccess = {
  success: true;
  // 공유받은 사람에게 앱 푸시 알림을 실제로 보냈는지
  notified: boolean;
  // 알림이 못 갔을 때 공유한 사람에게 보여줄 이유(공유 자체는 성공한 상태)
  notice: string | null;
};

// 공유 직후 공유받은 사람의 기기(앱 푸시)로 알림을 보낸다. 알림은 부가
// 기능이라 어떤 이유로든 실패해도 공유 자체를 실패로 만들지 않고, 대신 왜
// 못 갔는지를 공유한 사람에게 알려준다(상대가 기기를 등록 안 했는데 "알림
// 보냈다"고 착각하면 안 되므로).
async function notifyNoteShared(
  supabase: ReturnType<typeof createClient>,
  targetEmail: string,
  ownerEmail: string,
  noteId: string,
  noteTitle: string,
  permission: 'view' | 'edit'
): Promise<{ notified: boolean; notice: string | null }> {
  const title = noteTitle.trim() || '제목 없음';
  const shortTitle = title.length > 40 ? `${title.slice(0, 40)}…` : title;
  try {
    const result = await sendPushToEmail(supabase, targetEmail, {
      title: '📒 업무수첩이 공유됐어요',
      body: `${ownerEmail}님이 "${shortTitle}" 수첩을 ${permission === 'edit' ? '편집' : '보기'} 권한으로 공유했어요.`,
      url: notesPath(noteId),
    });

    if (result.queryError) {
      console.error('[work notes] 공유 알림 대상 조회 실패:', result.queryError);
      return {
        notified: false,
        notice: '공유는 됐지만 알림 설정이 아직 준비되지 않아 알림은 보내지 못했어요.',
      };
    }
    if (result.noDevice) {
      return {
        notified: false,
        notice: `공유는 됐어요. 다만 ${targetEmail}님이 아직 이 계정으로 앱 푸시 알림 기기를 등록하지 않아서 알림은 가지 않았어요. (알림 설정 화면에서 "이 기기 등록하기"를 눌러야 해요)`,
      };
    }
    if (result.sent === 0) {
      console.error('[work notes] 공유 알림 전송 전부 실패:', result.details);
      return {
        notified: false,
        notice: '공유는 됐지만 알림 전송에 실패했어요. 상대방이 알림 설정에서 기기를 다시 등록해야 할 수 있어요.',
      };
    }
    return { notified: true, notice: null };
  } catch (e) {
    console.error('[work notes] 공유 알림 전송 오류:', e);
    const msg = typeof (e as any)?.message === 'string' ? (e as any).message : '';
    return {
      notified: false,
      notice: /VAPID/.test(msg)
        ? '공유는 됐지만 알림을 보내지 못했어요. 서버에 푸시 알림 키(VAPID)가 없어요 - 서버 .env.local의 NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY를 확인해야 해요.'
        : '공유는 됐지만 알림을 보내지 못했어요. (푸시 알림 서버 설정 확인 필요)',
    };
  }
}

// 공유 대상 이메일 → auth uuid 변환 (allowed_users엔 이메일만 있고 uuid가
// 없다). 1순위는 DB 함수 lookup_allowed_user_id(마이그레이션 20261112130000) -
// 서버 환경변수 없이 동작한다. 그 함수가 아직 DB에 없거나 호출이 실패하면
// 예전 방식(service role 키로 auth.admin.listUsers)으로 한 번 더 시도한다.
// 키가 비어있으면 createClient()가 그 자리에서 예외를 던지는데(supabase-js
// 자체 동작), 잡지 않으면 Server Action이 죽어서 "Server Components render"
// 원시 에러 화면이 뜨므로(실제로 맥북 env에 키가 없어서 재현됨) try/catch로
// 막아 한국어 안내로 바꾼다.
async function resolveShareTargetUser(
  supabase: ReturnType<typeof createClient>,
  targetEmail: string
): Promise<{ id: string } | { error: string }> {
  const { data: rpcId, error: rpcError } = await supabase.rpc('lookup_allowed_user_id', {
    p_email: targetEmail,
  });
  if (!rpcError) {
    if (typeof rpcId === 'string' && rpcId) return { id: rpcId };
    return { error: '해당 이메일로 가입된 계정을 찾지 못했어요.' };
  }
  console.error('[work notes] lookup_allowed_user_id 호출 실패, 관리자 키 방식으로 재시도:', rpcError.message);

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error('[work notes] 관리자 클라이언트 생성 실패(SUPABASE_SERVICE_ROLE_KEY 확인 필요):', e);
    return { error: '공유 기능이 아직 설정되지 않았어요. 잠시 후 다시 시도해주세요.' };
  }
  const { data: usersPage, error: listError } = await admin.auth.admin.listUsers({
    perPage: 1000,
  });
  if (listError) {
    console.error('[work notes] 사용자 목록 조회 실패:', listError.message);
    return { error: '사용자 정보를 확인하지 못했어요. 잠시 후 다시 시도해주세요.' };
  }
  const found = usersPage.users.find((u) => u.email?.toLowerCase() === targetEmail.toLowerCase());
  if (!found) return { error: '해당 이메일로 가입된 계정을 찾지 못했어요.' };
  return { id: found.id };
}

export async function setNoteShare(
  noteId: string,
  targetEmail: string,
  permission: 'view' | 'edit' | null
): Promise<{ error: string } | SetNoteShareSuccess> {
  const supabase = createClient();
  const guard = await getAllowedUser(supabase);
  if ('error' in guard) return { error: guard.error };
  const { user } = guard;

  const { data: note, error: noteError } = await supabase
    .from('work_notes')
    .select('id, owner_id, title')
    .eq('id', noteId)
    .maybeSingle();
  if (noteError) {
    console.error('[work notes] 공유 설정 변경 전 조회 실패:', noteError.message);
    return { error: '공유 설정을 바꾸지 못했어요. 잠시 후 다시 시도해주세요.' };
  }
  if (!note || note.owner_id !== user.id) {
    return { error: '이 노트의 공유 설정을 바꿀 권한이 없어요.' };
  }
  if (targetEmail.toLowerCase() === user.email.toLowerCase()) {
    return { error: '본인에게는 공유할 수 없어요.' };
  }

  if (permission === null) {
    const { error } = await supabase
      .from('work_note_shares')
      .delete()
      .eq('note_id', noteId)
      .eq('target_email', targetEmail);
    if (error) {
      console.error('[work notes] 공유 해제 실패:', error.message);
      return { error: '공유를 해제하지 못했어요. 잠시 후 다시 시도해주세요.' };
    }
    revalidatePath(notesPath(noteId));
    return { success: true, notified: false, notice: null };
  }

  const targetUser = await resolveShareTargetUser(supabase, targetEmail);
  if ('error' in targetUser) return { error: targetUser.error };

  // 알림은 "새로 공유했거나 권한이 바뀐" 경우에만 보낸다(같은 값을 다시 저장해도
  // 알림이 또 가면 스팸). 기존 공유 조회가 실패하면 보수적으로 "새 공유"로 보고
  // 알림을 보낸다.
  const { data: existingShare } = await supabase
    .from('work_note_shares')
    .select('permission')
    .eq('note_id', noteId)
    .eq('target_user_id', targetUser.id)
    .maybeSingle();
  const shouldNotify = !existingShare || existingShare.permission !== permission;

  const { error: upsertError } = await supabase.from('work_note_shares').upsert(
    {
      note_id: noteId,
      target_user_id: targetUser.id,
      target_email: targetEmail,
      permission,
      created_by: user.id,
    },
    { onConflict: 'note_id,target_user_id' }
  );
  if (upsertError) {
    console.error('[work notes] 공유 설정 저장 실패:', upsertError.message);
    return { error: '공유 설정을 바꾸지 못했어요. 잠시 후 다시 시도해주세요.' };
  }

  revalidatePath(notesPath(noteId));

  if (!shouldNotify) return { success: true, notified: false, notice: null };
  const { notified, notice } = await notifyNoteShared(
    supabase,
    targetEmail,
    user.email,
    noteId,
    note.title ?? '',
    permission
  );
  return { success: true, notified, notice };
}

export async function getNoteHistory(
  noteId: string,
  limit = 50
): Promise<{ entries: NoteHistoryListItem[] } | { error: string }> {
  const supabase = createClient();
  const guard = await getAllowedUser(supabase);
  if ('error' in guard) return { error: guard.error };

  const { data, error } = await supabase
    .from('work_note_history')
    .select('id, rev, title, edited_by_email, edited_at')
    .eq('note_id', noteId)
    .order('edited_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[work notes] 변경 이력 목록 조회 실패:', error.message);
    return { error: '변경 이력을 가져오지 못했어요. 잠시 후 다시 시도해주세요.' };
  }

  return {
    entries: (data ?? []).map((h) => ({
      id: h.id,
      rev: h.rev,
      title: h.title,
      editedByEmail: h.edited_by_email,
      editedAt: h.edited_at,
    })),
  };
}

export async function getNoteHistoryEntry(
  historyId: string
): Promise<{ entry: NoteHistoryDetail } | { error: string }> {
  const supabase = createClient();
  const guard = await getAllowedUser(supabase);
  if ('error' in guard) return { error: guard.error };

  const { data, error } = await supabase
    .from('work_note_history')
    .select('id, rev, title, body, edited_by_email, edited_at')
    .eq('id', historyId)
    .maybeSingle();
  if (error) {
    console.error('[work notes] 변경 이력 조회 실패:', error.message);
    return { error: '이 변경 이력을 가져오지 못했어요. 잠시 후 다시 시도해주세요.' };
  }
  if (!data) return { error: '이 변경 이력을 더 이상 볼 수 없어요.' };

  return {
    entry: {
      id: data.id,
      rev: data.rev,
      title: data.title,
      body: (data.body as JSONContent) ?? EMPTY_DOC,
      editedByEmail: data.edited_by_email,
      editedAt: data.edited_at,
    },
  };
}
