// Bright Data Web Unlocker로 쿠팡 전체 판매 랭킹(우리 판매 데이터가 아니라
// 시장 전체)과 1688/알리바바 소싱 후보를 실시간으로 긁어온다. 공개 API가
// 없는 데이터라서 직접 페이지를 읽어와서 파싱한다.

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정 안 되어있어요.`);
  return v;
}

// 서버리스 함수 전체 타임아웃(120초) 안에서 여러 키워드를 병렬 조회해야
// 하므로, 개별 요청 하나가 무한정 오래 걸려서 전체를 물고 가지 않도록
// 요청당 타임아웃을 짧게 건다.
async function unlockerMarkdown(
  url: string,
  options: { country?: string; retries?: number; timeoutMs?: number } = {}
): Promise<string> {
  const apiKey = requireEnv('BRIGHTDATA_API_KEY');
  const zone = requireEnv('BRIGHTDATA_UNLOCKER_ZONE');
  const retries = options.retries ?? 0;
  const timeoutMs = options.timeoutMs ?? 30000;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          zone,
          format: 'raw',
          data_format: 'markdown',
          ...(options.country ? { country: options.country } : {}),
        }),
        signal: controller.signal,
      });

      if (res.ok) {
        const text = await res.text();
        if (!/captcha|protection page/i.test(text.slice(0, 200))) {
          return text;
        }
      }
      if (attempt === retries) {
        throw new Error(`Bright Data 요청 실패 (HTTP ${res.status})`);
      }
    } catch (e: any) {
      if (attempt === retries) {
        throw e?.name === 'AbortError' ? new Error('Bright Data 요청 시간 초과') : e;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Bright Data 요청 실패');
}

export interface CoupangBestseller {
  rank: number;
  name: string;
  price: string | null;
  reviewCount: string | null;
  url: string;
  imageUrl: string | null;
}

// 쿠팡 검색 결과를 판매량순으로 정렬해서 가져온다 - 우리 판매 데이터가
// 아니라 쿠팡 전체(다른 셀러 포함) 시장에서 실제로 잘 팔리는 상품 신호.
export async function fetchCoupangBestsellers(
  keyword: string,
  limit = 8
): Promise<CoupangBestseller[]> {
  const md = await unlockerMarkdown(
    `https://www.coupang.com/np/search?component=&q=${encodeURIComponent(keyword)}&sorter=saleCountDesc`,
    { country: 'kr', timeoutMs: 25000 }
  );

  const blockRe =
    /\*\s+\[\s*\n\s*!\[([^\]]*)\]\(([^)]*)\)\s*\n\s*\1\s*\n([\s\S]*?)\]\((\/vp\/products\/[^)]+)\)/g;

  const results: CoupangBestseller[] = [];
  let m: RegExpExecArray | null;
  let rank = 0;
  while ((m = blockRe.exec(md)) && results.length < limit) {
    rank++;
    const name = m[1].trim();
    const imageUrl = m[2].trim() || null;
    const body = m[3];
    const relUrl = m[4];

    const priceLines = [...body.matchAll(/\n\s*([\d,]+)원\s*\n/g)].map((x) => x[1]);
    const discountMatch = body.match(/할인([\d,]+)원/);
    let price: string | null = null;
    for (const p of priceLines) {
      if (discountMatch && p === discountMatch[1]) continue;
      price = p;
      break;
    }

    const reviewMatch = body.match(/\n\s*\((\d[\d,]*)\)\s*\n/);
    const reviewCount = reviewMatch ? reviewMatch[1] : null;

    results.push({
      rank,
      name,
      price,
      reviewCount,
      url: `https://www.coupang.com${relUrl}`,
      imageUrl,
    });
  }
  return results;
}

export interface AlibabaProduct {
  name: string;
  price: string | null;
  url: string;
  imageUrl: string | null;
}

// 알리바바(alibaba.com)에서 소싱 후보 상품을 검색한다 - 1688은 중국 국내용
// 사이트라 봇 차단이 훨씬 강해서, 해외 소싱 셀러도 실제로 많이 쓰는
// alibaba.com(영문/도매)을 대신 사용한다.
export async function fetchAlibabaProducts(
  keyword: string,
  limit = 3
): Promise<AlibabaProduct[]> {
  // 알리바바는 봇 차단이 강해서 정상 응답도 60초 가까이 걸릴 수 있다.
  const md = await unlockerMarkdown(
    `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(keyword)}`,
    { country: 'us', timeoutMs: 90000 }
  );

  const headingRe = /^## \[(.+?)\]\((\/\/www\.alibaba\.com\/product-detail\/[^)]+)\)/gm;
  const headings = [...md.matchAll(headingRe)];

  const results: AlibabaProduct[] = [];
  for (let i = 0; i < headings.length && results.length < limit; i++) {
    const name = headings[i][1]
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\*\*/g, '')
      .trim();
    const url = 'https:' + headings[i][2];
    const start = headings[i].index!;
    const end = i + 1 < headings.length ? headings[i + 1].index! : md.length;
    const chunk = md.slice(start, Math.min(end, start + 2000));
    const priceMatch = chunk.match(/\$([\d.]+)(?:-([\d.]+))?/);
    const price = priceMatch
      ? priceMatch[2]
        ? `$${priceMatch[1]}-${priceMatch[2]}`
        : `$${priceMatch[1]}`
      : null;

    // 상품 썸네일은 보통 헤딩 바로 앞쪽에 같은 상품 링크로 감싸여 등장한다
    const before = md.slice(Math.max(0, start - 1500), start);
    const imageMatches = [
      ...before.matchAll(/!\[[^\]]*\]\((https:[^)]+\.(?:jpg|jpeg|png|webp)[^)]*)\)/g),
    ];
    const imageUrl = imageMatches.length > 0 ? imageMatches[imageMatches.length - 1][1] : null;

    results.push({ name, price, url, imageUrl });
  }
  return results;
}
