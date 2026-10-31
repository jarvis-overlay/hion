// 상세페이지 "한 번에 만들기" - 사진 분석 + 쿠팡 상세페이지 구성 학습.
//
//  1) analyzeSourceImage: 중국어가 박힌 상품 사진 한 장을 비전 모델로 분석한다
//     (무슨 사진인지, 사진 속 중국어의 한국어 번역, 확인되는 사실, 보이는 색상, 사이즈표).
//  2) learnDetailFlow: 쿠팡에서 잘 팔리는 상위 상품의 상세 설명 이미지를 분석해서
//     "상세페이지가 어떤 순서로, 어떤 장면들로 흘러가는지"를 정리한다.
// 두 결과를 합쳐 구성안을 짜는 건 lib/ai.ts(planDetailSections), 취급하지 않는
// 색상/사이즈를 걸러내는 규칙은 lib/detailOptions.ts에 있다.
import { fetchCoupangBestsellers, fetchCoupangDetailImageUrls } from '@/lib/brightdata';
import { fetchImageFromUrl, VISION_MODEL } from '@/lib/imageProcessing';
import { normalizeSourceAnalysis, type SourceAnalysis } from '@/lib/detailOptions';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정 안 되어있어요.`);
  return v;
}

function parseJsonObject(text: string): any {
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonText = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(jsonText);
}

async function geminiVision(parts: Record<string, unknown>[]): Promise<string> {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Gemini API 오류 (HTTP ${res.status})`);
  return (json.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
}

// ---------------------------------------------------------------------------
// 1) 상품 사진 한 장 분석
// ---------------------------------------------------------------------------
export async function analyzeSourceImage(img: { buffer: Buffer; mimeType: string }): Promise<SourceAnalysis> {
  const prompt = `당신은 중국 1688/타오바오 상품 사진을 분석해 한국 쿠팡 상세페이지를 기획하는 이커머스 기획자입니다. 첨부된 사진 한 장을 분석해서 JSON 객체로만 답하세요.

규칙:
- 사진 속 중국어·영어 문구는 한국어로 번역해 koreanTexts에 담으세요. 뜻을 바꾸거나 과장하지 마세요. 문구가 없으면 빈 배열.
- facts에는 사진과 사진 속 문구에서 **확인되는 사실만** 담으세요 (소재, 기능, 구성품, 제조/사용 정보 등). 추측이나 일반적인 장점은 넣지 마세요.
- colorsShown에는 사진에 보이는 **상품의 색상**을 한국어 색상명으로 모두 적으세요. 한 장에 여러 색상이 나열돼 있으면 전부 적어야 합니다. 모델·배경·소품의 색은 제외하세요.
- sizeChart는 사이즈표가 있을 때만: headers(열 제목 배열)와 rows(각 행의 칸 배열, 숫자는 사진 그대로)를 담으세요. 없으면 null.
- sizesMentioned에는 사진에 언급된 사이즈 표기(S, M, L, XL, 2XL 등)를 담으세요.
- role은 다음 중 하나: "hero"(상품 전체 컷), "detail"(확대/디테일), "size_chart"(사이즈표), "color_lineup"(여러 색상 나열), "usage"(사용/착용 장면), "package"(포장/구성품), "material"(소재 설명), "other".
- description은 무엇이 찍혀 있는지 한국어 한두 문장.

응답 형식:
{"role":"...","description":"...","koreanTexts":["..."],"facts":["..."],"colorsShown":["..."],"sizeChart":{"headers":["..."],"rows":[["..."]]},"sizesMentioned":["..."]}`;

  const text = await geminiVision([
    { text: prompt },
    { inlineData: { mimeType: img.mimeType, data: img.buffer.toString('base64') } },
  ]);
  let raw: any;
  try {
    raw = parseJsonObject(text);
  } catch {
    console.error('[detailCompose] 사진 분석 응답 파싱 실패:', text.slice(0, 300));
    throw new Error('사진 분석 결과를 해석하지 못했어요.');
  }
  return normalizeSourceAnalysis(raw);
}

// ---------------------------------------------------------------------------
// 2) 쿠팡 상세페이지 구성 학습
// ---------------------------------------------------------------------------
export interface DetailFlowStep {
  title: string; // 장면 이름
  purpose: string; // 이 장면이 하는 역할
  note: string; // 인기상품에서 보이는 표현/배치 방식
}

export interface DetailFlowBrief {
  summary: string;
  tone: string;
  sellingPoints: string[];
  flow: DetailFlowStep[];
  analysis?: { products: number; detailImages: number; mainImages: number };
}

// 카테고리를 안 정했거나 쿠팡 학습에 실패했을 때 쓰는 일반적인 흐름 (쿠팡 참고 아님)
export const DEFAULT_DETAIL_FLOW: DetailFlowBrief = {
  summary: '쿠팡 인기상품을 참고하지 않은 일반적인 상세페이지 흐름이에요.',
  tone: '간결하고 신뢰감 있는 톤',
  sellingPoints: [],
  flow: [
    { title: '첫인상(훅)', purpose: '상품을 한눈에 보여주고 핵심 한 줄로 관심을 끈다', note: '큰 상품 사진 + 짧은 헤드라인' },
    { title: '핵심 장점 요약', purpose: '구매 이유를 3~4가지로 정리', note: '번호/체크 목록' },
    { title: '디테일 1', purpose: '소재·마감 등 눈으로 확인되는 장점', note: '확대 사진 + 한 줄 설명' },
    { title: '사용 장면', purpose: '쓰는 모습을 상상하게 한다', note: '분위기 있는 사진 위 문구' },
    { title: '디테일 2', purpose: '구성·기능 보충 설명', note: '사진 + 한 줄 설명' },
    { title: '제품 사양', purpose: '소재·색상·사이즈 등 정보를 표로 정리', note: '라벨/값 표' },
    { title: '마무리', purpose: '신뢰를 주는 짧은 마무리 메시지', note: '여백 있는 문구' },
  ],
};

function normalizeFlow(raw: any): DetailFlowBrief {
  const flow: DetailFlowStep[] = (Array.isArray(raw?.flow) ? raw.flow : [])
    .map((s: any) => ({
      title: String(s?.title ?? '').trim().slice(0, 30),
      purpose: String(s?.purpose ?? '').trim().slice(0, 120),
      note: String(s?.note ?? '').trim().slice(0, 120),
    }))
    .filter((s: DetailFlowStep) => s.title)
    .slice(0, 10);
  if (flow.length < 4) throw new Error('쿠팡 상세페이지 구성 분석 결과를 해석하지 못했어요. 잠시 후 다시 시도해주세요.');
  return {
    summary: String(raw?.summary ?? '').trim().slice(0, 400),
    tone: String(raw?.tone ?? '').trim().slice(0, 100),
    sellingPoints: (Array.isArray(raw?.sellingPoints) ? raw.sellingPoints : [])
      .map((p: unknown) => String(p ?? '').trim().slice(0, 20))
      .filter(Boolean)
      .slice(0, 8),
    flow,
  };
}

export { normalizeFlow as normalizeDetailFlow };

// 상위 상품의 상세 설명 이미지를 읽어서 흐름을 배운다. 페이지 크롤링은 느리고 한도가
// 있어서(분당 8건) 상위 3개 상품만 보고, 정해진 시간 안에 끝난 것만 쓴다. 상세 이미지를
// 못 읽으면 검색결과 대표 이미지만으로 분석하고 그 사실을 analysis에 남겨 화면에 알린다.
export async function learnDetailFlow(category: string): Promise<DetailFlowBrief> {
  const q = category.trim();
  if (!q) throw new Error('카테고리/검색어를 먼저 입력해주세요.');

  const bestsellers = await fetchCoupangBestsellers(q, 10, { budgetMs: 60_000 });
  const mainCandidates = bestsellers.filter((b) => b.imageUrl).slice(0, 4);
  if (mainCandidates.length < 2) {
    throw new Error(`"${q}" 인기상품을 충분히 찾지 못했어요. 카테고리/검색어를 바꿔보세요.`);
  }

  const done: { b: (typeof bestsellers)[number]; urls: string[] }[] = [];
  const tasks = bestsellers.slice(0, 3).map(async (b) => {
    try {
      done.push({ b, urls: (await fetchCoupangDetailImageUrls(b.url, 8)).slice(0, 6) });
    } catch (e) {
      console.error('[detailCompose] 상세 이미지 조회 실패:', b.url, e);
    }
  });
  await Promise.race([Promise.all(tasks), new Promise<void>((r) => setTimeout(r, 80_000))]);

  const dl = async (url: string) => {
    try {
      return await fetchImageFromUrl(url);
    } catch {
      return null;
    }
  };
  const mains = (await Promise.all(mainCandidates.map(async (b) => ({ b, img: await dl(b.imageUrl!) })))).filter(
    (x): x is { b: typeof x.b; img: NonNullable<typeof x.img> } => x.img !== null
  );
  const details = (
    await Promise.all(
      done.map(async ({ b, urls }) => ({
        b,
        imgs: (await Promise.all(urls.map(dl))).filter((x): x is NonNullable<typeof x> => x !== null),
      }))
    )
  ).filter((d) => d.imgs.length > 0);
  const detailCount = details.reduce((s, d) => s + d.imgs.length, 0);

  const detailNote = details.length
    ? `이어서 상위 상품 ${details.length}개의 "상세 설명 이미지"가 상품별로, 페이지에 나오는 **위에서 아래 순서 그대로** 첨부돼 있습니다:\n${details
        .map((d) => `- ${d.b.name}: ${d.imgs.length}장`)
        .join('\n')}\n상세페이지가 어떤 순서·장면으로 흘러가는지는 **이쪽을 가장 중요하게** 분석하세요.`
    : '(상세 설명 이미지는 가져오지 못했어요. 대표 이미지와 상품 정보만으로 이 카테고리 상세페이지의 일반적인 흐름을 추정하되, 추정이라는 점이 summary에 드러나게 쓰세요.)';

  const prompt = `당신은 쿠팡 상세페이지 기획자입니다. 쿠팡에서 "${q}"를 검색했을 때 판매량순 상위 상품들의 상세페이지가 어떤 흐름으로 구성되는지 분석해주세요.

먼저 상위 상품 ${mains.length}개의 대표 이미지가 순서대로 첨부돼 있습니다:
${mains.map(({ b }, i) => `${i + 1}. ${b.name} / 가격 ${b.price ?? '?'} / 리뷰 ${b.reviewCount ?? '?'}`).join('\n')}

${detailNote}

분석 규칙:
- 특정 브랜드·로고·문구를 베끼지 말고, 여러 상품에 공통으로 보이는 흐름만 정리하세요.
- flow는 상세페이지를 위에서 아래로 읽을 때의 장면 순서입니다 (6~9개). 각 장면의 title(장면 이름), purpose(그 장면이 하는 일), note(그 장면에서 흔히 쓰는 사진/문구/배치 방식)를 적으세요.
- tone은 인기상품 문구의 어조(예: 간결·신뢰, 감성적, 기능 강조 등).
- sellingPoints는 이 카테고리 인기상품이 공통으로 강조하는 장점 키워드(한국어 단어) 최대 6개.

반드시 JSON 객체로만 응답하세요:
{"summary":"공통 흐름 요약 2~3문장","tone":"...","sellingPoints":["..."],"flow":[{"title":"...","purpose":"...","note":"..."}]}`;

  const parts: Record<string, unknown>[] = [{ text: prompt }];
  for (const { img } of mains) parts.push({ inlineData: { mimeType: img.mimeType, data: img.buffer.toString('base64') } });
  for (const d of details) {
    for (const img of d.imgs) parts.push({ inlineData: { mimeType: img.mimeType, data: img.buffer.toString('base64') } });
  }

  const text = await geminiVision(parts);
  let raw: any;
  try {
    raw = parseJsonObject(text);
  } catch {
    console.error('[detailCompose] 상세 구성 분석 응답 파싱 실패:', text.slice(0, 300));
    throw new Error('쿠팡 상세페이지 구성 분석 결과를 해석하지 못했어요. 잠시 후 다시 시도해주세요.');
  }
  const brief = normalizeFlow(raw);
  brief.analysis = { products: details.length, detailImages: detailCount, mainImages: mains.length };
  return brief;
}
