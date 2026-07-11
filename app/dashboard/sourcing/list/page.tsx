import { createClient } from '@/lib/supabase/server';
import SourcingForm from '@/components/SourcingForm';
import SourcingCard from '@/components/SourcingCard';

export default async function SourcingPage() {
  const supabase = createClient();
  const { data: posts } = await supabase
    .from('sourcing_posts')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">소싱 리스트</h1>
      <p className="text-sm text-inkSoft mb-5">
        소싱 후보 상품을 등록하고 검토중 · 발주완료 · 보류 상태로 관리
      </p>
      <SourcingForm />
      <div className="grid gap-3 sm:grid-cols-2">
        {posts?.length ? (
          posts.map((p) => <SourcingCard key={p.id} post={p} />)
        ) : (
          <p className="text-sm text-inkSoft col-span-2">
            아직 등록된 소싱 후보가 없어요.
          </p>
        )}
      </div>
    </div>
  );
}
