import { NextResponse } from "next/server";

const KOREAEXIM_AUTH_KEY = process.env.KOREAEXIM_AUTHKEY || "";

function formatDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

async function fetchKoreaEximSingle(searchDateStr: string) {
  if (!KOREAEXIM_AUTH_KEY) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    const apiUrl = `https://www.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${KOREAEXIM_AUTH_KEY}&searchdate=${searchDateStr}&data=AP01`;

    const res = await fetch(apiUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const rawList = await res.json();
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
    }
  } catch {
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

  // [T04-RECOVER-D2] 정상 복구 및 D2 날짜 기록 추가 시뮬레이션
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
    });
  }

  // ==========================================
  // [카드 1, 4, 5] 실제 원천 조회 및 이틀 기록 수집
  // ==========================================
  const nowTimeStr = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
  const today = new Date();
  const fetchedList: any[] = [];

  for (let i = 0; i < 7; i++) {
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() - i);
    const searchDateStr = formatDateStr(targetDate);

    const data = await fetchKoreaEximSingle(searchDateStr);
    if (data) {
      fetchedList.push({
        ...data,
        fetchedTime: nowTimeStr,
        timezone: "Asia/Seoul",
      });
      if (fetchedList.length >= 2) break; // 어제/오늘 2일치 수집
    }
  }

  if (fetchedList.length > 0) {
    return NextResponse.json({
      status: "success",
      data: fetchedList[0],
      previousData: fetchedList.length > 1 ? fetchedList[1] : null,
    });
  }

  // 폴백 백업 (오픈 API)
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=KRW", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data?.rates?.KRW) {
        return NextResponse.json({
          status: "success",
          data: {
            value: data.rates.KRW,
            unit: "KRW / USD",
            sourceName: "ECB Exchange Rates (Fallback)",
            sourceUrl: "https://www.frankfurter.app",
            sourceTime: `${data.date} 00:00:00`,
            fetchedTime: nowTimeStr,
            timezone: "Asia/Seoul",
            rawJsonStr: JSON.stringify(data),
          },
        });
      }
    }
  } catch {}

  return NextResponse.json(
    { error_code: "ERR_TIMEOUT", message: "모든 외부 원천 응답 수신 실패" },
    { status: 504 }
  );
}