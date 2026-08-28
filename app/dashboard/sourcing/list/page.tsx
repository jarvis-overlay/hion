import { createClient } from '@/lib/supabase/server';
import SourcingForm from '@/components/SourcingForm';
import SourcingList from '@/components/SourcingList';

export default async function SourcingPage() {
  const supabase = createClient();
  const { data: items } = await supabase
    .from('sourcing_items')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">소싱</h1>
      <p className="text-sm text-inkSoft mb-5">
        소싱 후보 상품을 등록하고 상태 · 마진까지 한 곳에서 관리해요
      </p>
      <SourcingForm />
      <SourcingList items={items || []} />
    </div>
  );
}
