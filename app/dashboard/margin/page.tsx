import { createClient } from '@/lib/supabase/server';
import MarginCalculator from '@/components/MarginCalculator';

export default async function MarginPage() {
  const supabase = createClient();
  const { data: entries } = await supabase
    .from('margin_entries')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-5">마진 계산기</h1>
      <MarginCalculator entries={entries || []} />
    </div>
  );
}
