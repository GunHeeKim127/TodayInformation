import { NextResponse } from "next/server";

const KOREAEXIM_AUTH_KEY = process.env.KOREAEXIM_AUTHKEY || "";

function formatDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function formatDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// 한국수출입은행 단일 날짜 조회 함수
async function fetchKoreaEximSingle(searchDateStr: string) {
  if (!KOREAEXIM_AUTH_KEY) {
    console.log("❌ [KOREAEXIM] AUTH_KEY가 설정되지 않았습니다. (.env.local 확인 필요)");
    return null;
  }

  try {
    const controller = new AbortController();
    // 타임아웃을 1.5초에서 3.5초로 늘려 응답 지연 시 조기 종료 방지
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const apiUrl = `https://www.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${KOREAEXIM_AUTH_KEY}&searchdate=${searchDateStr}&data=AP01`;

    const res = await fetch(apiUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const rawList = await res.json();
      console.log(`🔍 [KOREAEXIM] ${searchDateStr} 응답 데이터 개수:`, Array.isArray(rawList) ? rawList.length : typeof rawList);

      if (Array.isArray(rawList) && rawList.length > 0) {
        const usdItem = rawList.find((item: any) => item.cur_unit === "USD");
        if (usdItem?.deal_bas_r) {
          const formattedSourceDate = `${searchDateStr.slice(0, 4)}-${searchDateStr.slice(4, 6)}-${searchDateStr.slice(6, 8)}`;
          return {
            value: parseFloat(usdItem.deal_bas_r.replace(/,/g, "")),
            unit: "KRW / USD",
            sourceName: "한국수출입은행 환율 정보",
            sourceUrl: "https://www.koreaexim.go.kr",
            sourceTime: `${formattedSourceDate} 11:00:00`,
            rawJsonStr: JSON.stringify(usdItem),
          };
        }
      }
    } else {
      console.log(`⚠️ [KOREAEXIM] ${searchDateStr} HTTP 응답 오류 status:`, res.status);
    }
  } catch (err: any) {
    console.log(`💥 [KOREAEXIM] ${searchDateStr} Fetch 에러 발생:`, err.message || err);
    return null;
  }
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixture = searchParams.get("fixture");

  // ==========================================
  // [카드 3] 5가지 실패 재생 및 RECOVER Fixtures
  // ==========================================
  if (fixture === "timeout") {
    return NextResponse.json(
      { error_code: "ERR_TIMEOUT", message: "외부 원천 응답 시간 초과 (504 Gateway Timeout)" },
      { status: 504 }
    );
  }
  if (fixture === "auth_denied") {
    return NextResponse.json(
      { error_code: "ERR_AUTH_DENIED", message: "외부 원천 인증 실패 (401/403 Access Denied)" },
      { status: 401 }
    );
  }
  if (fixture === "rate_limit") {
    return NextResponse.json(
      { error_code: "ERR_RATE_LIMIT", message: "외부 원천 호출 한도 초과 (429 Too Many Requests)" },
      { status: 429 }
    );
  }
  if (fixture === "offline") {
    return NextResponse.json(
      { error_code: "ERR_OFFLINE", message: "네트워크 연결 끊김 (Offline / Disconnected)" },
      { status: 503 }
    );
  }
  if (fixture === "schema_changed") {
    return NextResponse.json(
      { error_code: "ERR_SCHEMA_CHANGED", message: "응답 규격/필드 구조 변경 오류 (Invalid Schema)" },
      { status: 500 }
    );
  }

  // [T04-RECOVER-D2] 정상 복구 테스트용 Mock 데이터
  if (fixture === "T04-RECOVER-D2") {
    return NextResponse.json({
      status: "success",
      data: {
        value: 1385.50,
        unit: "KRW / USD",
        sourceName: "한국수출입은행 환율 정보",
        sourceUrl: "https://www.koreaexim.go.kr",
        sourceTime: "2026-09-11 11:00:00",
        fetchedTime: "2026-09-11 15:30:00",
        timezone: "Asia/Seoul",
        rawJsonStr: JSON.stringify({ deal_bas_r: "1,385.50", cur_unit: "USD" }),
      },
      previousData: {
        value: 1370.00,
        unit: "KRW / USD",
        sourceName: "한국수출입은행 환율 정보",
        sourceUrl: "https://www.koreaexim.go.kr",
        sourceTime: "2026-09-10 11:00:00",
        fetchedTime: "2026-09-10 15:30:00",
        timezone: "Asia/Seoul",
        rawJsonStr: JSON.stringify({ deal_bas_r: "1,370.00", cur_unit: "USD" }),
      }
    });
  }

  // ==========================================
  // [핵심 개편] 2일치 영업일 데이터를 찾을 때까지 과거로 계속 탐색하는 로직
  // ==========================================
  const nowTimeStr = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
  const today = new Date();
  const fetchedList: any[] = [];

  console.log("🚀 [API START] 환율 탐색 루프를 시작합니다. (오늘 날짜:", formatDateStr(today), ")");

  // 주말, 공휴일, 연휴를 감안하여 최근 14일 전까지 루프 탐색
  for (let i = 0; i < 14; i++) {
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() - i);
    const searchDateStr = formatDateStr(targetDate);

    const data = await fetchKoreaEximSingle(searchDateStr);

    // 영업일 데이터가 존재할 때만 리스트에 추가
    if (data) {
      fetchedList.push({
        ...data,
        fetchedTime: nowTimeStr,
        timezone: "Asia/Seoul",
      });

      // 2일치가 모두 채워지면 더 이상 탐색하지 않고 종료
      if (fetchedList.length >= 2) {
        break;
      }
    }
  }

  // 1) 한국수출입은행 API로 2일치를 모두 확보했을 경우
  if (fetchedList.length >= 2) {
    console.log("✅ [KOREAEXIM] 2일치 환율 수집 성공!");
    return NextResponse.json({
      status: "success",
      data: fetchedList[0],         // 가장 최근 영업일
      previousData: fetchedList[1], // 바로 직전 영업일
    });
  }

  console.log("⚠️ [FALLBACK] 수출입은행 데이터 부족 (확보 수:", fetchedList.length, "개). Frankfurter 오픈 API로 대체 시도 중...");

  // 2) 만약 한국수출입은행 API에서 1개만 구했거나 실패했을 경우, 오픈 API(Frankfurter)로 과거 10일 범위 조회
  try {
    const endDate = formatDateISO(today);
    const startDateObj = new Date(today);
    startDateObj.setDate(today.getDate() - 10);
    const startDate = formatDateISO(startDateObj);

    // 기간 범위 조회 API 호출
    const res = await fetch(`https://api.frankfurter.app/${startDate}..${endDate}?from=USD&to=KRW`, { cache: "no-store" });

    if (res.ok) {
      const json = await res.json();
      const ratesObj = json.rates || {};
      const dates = Object.keys(ratesObj).sort(); // 오름차순 (과거 -> 최근)

      if (dates.length >= 2) {
        const latestDate = dates[dates.length - 1];
        const prevDate = dates[dates.length - 2];

        return NextResponse.json({
          status: "success",
          data: {
            value: ratesObj[latestDate].KRW,
            unit: "KRW / USD",
            sourceName: "ECB Exchange Rates (Fallback)",
            sourceUrl: "https://www.frankfurter.app",
            sourceTime: `${latestDate} 00:00:00`,
            fetchedTime: nowTimeStr,
            timezone: "Asia/Seoul",
            rawJsonStr: JSON.stringify({ date: latestDate, rate: ratesObj[latestDate] }),
          },
          previousData: {
            value: ratesObj[prevDate].KRW,
            unit: "KRW / USD",
            sourceName: "ECB Exchange Rates (Fallback)",
            sourceUrl: "https://www.frankfurter.app",
            sourceTime: `${prevDate} 00:00:00`,
            fetchedTime: nowTimeStr,
            timezone: "Asia/Seoul",
            rawJsonStr: JSON.stringify({ date: prevDate, rate: ratesObj[prevDate] }),
          }
        });
      }
    }
  } catch (e: any) {
    console.log("💥 [FALLBACK ERROR]", e.message || e);
  }

  // 3) 만약 1개만 구해졌더라도 없는 것보단 낫다면 리턴
  if (fetchedList.length === 1) {
    return NextResponse.json({
      status: "success",
      data: fetchedList[0],
      previousData: null
    });
  }

  return NextResponse.json(
    { error_code: "ERR_TIMEOUT", message: "모든 외부 원천 응답 수신 실패" },
    { status: 504 }
  );
}