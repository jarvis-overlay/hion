import { createClient } from '@/lib/supabase/server';
import InfoForm from '@/components/InfoForm';
import InfoCard from '@/components/InfoCard';

export default async function SourcingInfoPage() {
  const supabase = createClient();
  const { data: notes } = await supabase
    .from('sourcing_notes')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">소싱 정보</h1>
      <p className="text-sm text-inkSoft mb-5">
        공급업체 정보, 협상 팁, 관세·통관 정보 등 자유롭게 공유
      </p>
      <InfoForm />
      <div className="grid gap-3 sm:grid-cols-2">
        {notes?.length ? (
          notes.map((n) => <InfoCard key={n.id} note={n} />)
        ) : (
          <p className="text-sm text-inkSoft col-span-2">
            아직 등록된 정보가 없어요.
          </p>
        )}
      </div>
    </div>
  );
}
