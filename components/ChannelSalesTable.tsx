const CHANNELS = [
  { key: 'coupang', label: '쿠팡' },
  { key: 'naver', label: '네이버' },
  { key: 'ohou', label: '오늘의집' },
  { key: 'ably', label: '에이블리' },
  { key: 'toss', label: '토스쇼핑' },
];

export default function ChannelSalesTable({
  products,
  salesRows,
  coupangStockByProduct,
}: {
  products: any[];
  salesRows: any[];
  coupangStockByProduct: Record<string, number>;
}) {
  const salesByProduct: Record<string, Record<string, number>> = {};
  for (const row of salesRows) {
    if (!salesByProduct[row.product_id]) salesByProduct[row.product_id] = {};
    salesByProduct[row.product_id][row.channel] =
      (salesByProduct[row.product_id][row.channel] || 0) +
      Math.abs(row.quantity);
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-ink text-xs text-inkSoft uppercase tracking-wide">
            <th className="text-left py-2 px-4 whitespace-nowrap">상품</th>
            <th className="text-right py-2 px-4 whitespace-nowrap">
              총 판매량
            </th>
            {CHANNELS.map((c) => (
              <th
                key={c.key}
                className="text-right py-2 px-4 whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
            <th className="text-right py-2 px-4 whitespace-nowrap">
              쿠팡 창고 재고
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const byChannel = salesByProduct[p.id] || {};
            const total = Object.values(byChannel).reduce(
              (s, v) => s + v,
              0
            );
            return (
              <tr
                key={p.id}
                className="border-b border-paperLine last:border-0"
              >
                <td className="py-2 px-4 font-medium whitespace-nowrap">
                  {p.name}
                </td>
                <td className="py-2 px-4 text-right font-mono font-bold">
                  {total}
                </td>
                {CHANNELS.map((c) => (
                  <td
                    key={c.key}
                    className="py-2 px-4 text-right font-mono text-inkSoft"
                  >
                    {byChannel[c.key] || 0}
                  </td>
                ))}
                <td className="py-2 px-4 text-right font-mono">
                  {coupangStockByProduct[p.id] ?? 0}
                </td>
              </tr>
            );
          })}
          {!products.length && (
            <tr>
              <td colSpan={8} className="py-4 px-4 text-center text-inkSoft">
                등록된 상품이 없어요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
