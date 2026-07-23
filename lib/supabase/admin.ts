import { createClient } from '@supabase/supabase-js';

// 자동 스케줄(Cron)처럼 로그인 세션이 없는 서버 작업 전용.
// SUPABASE_SERVICE_ROLE_KEY는 절대 클라이언트에 노출되면 안 되고,
// 이 파일은 서버 코드(API route, server action)에서만 import 해야 함.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
