const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');

export default function DailySalesHistory({ rows }: { rows: any[] }) {
  // occurred_at을 한국시간 기준 날짜(yyyy-mm-dd)로 묶어서 일자별 합계 계산
  const byDate: Record<string, { qty: number; amount: number }> = {};

  for (const row of rows) {
    const d = new Date(row.occurred_at);
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const dateKey = kst.toISOString().slice(0, 10);

    if (!byDate[dateKey]) byDate[dateKey] = { qty: 0, amount: 0 };
    byDate[dateKey].qty += Math.abs(row.quantity);
    byDate[dateKey].amount += Number(row.amount) || 0;
  }

  const dates = Object.keys(byDate).sort((a, b) => (a < b ? 1 : -1));

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-ink text-xs text-inkSoft uppercase tracking-wide">
            <th className="text-left py-2 px-4">날짜</th>
            <th className="text-right py-2 px-4">매출금액</th>
            <th className="text-right py-2 px-4">판매수량</th>
          </tr>
        </thead>
        <tbody>
          {dates.map((date) => (
            <tr key={date} className="border-b border-paperLine last:border-0">
              <td className="py-2 px-4 font-mono">{date}</td>
              <td className="py-2 px-4 text-right font-mono">
                {fmt(byDate[date].amount)}원
              </td>
              <td className="py-2 px-4 text-right font-mono font-bold">
                {byDate[date].qty}개
              </td>
            </tr>
          ))}
          {!dates.length && (
            <tr>
              <td colSpan={3} className="py-4 px-4 text-center text-inkSoft">
                아직 판매 히스토리가 없어요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
