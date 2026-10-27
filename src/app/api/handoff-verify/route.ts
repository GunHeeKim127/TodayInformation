import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

function getHandoffContent(): string {
  const possiblePaths = [
    path.join(process.cwd(), "HANDOFF_TASK_05.md"),
    path.join(process.cwd(), "HANDOFF_TASK_05.MD"),
  ];

  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }
  }

  return "HANDOFF_TASK_05.md 파일이 존재하지 않습니다.";
}

// 503(Service Unavailable) 또는 일시적 API 오류 발생 시 Exponential Backoff 재시도 헬퍼 함수
async function fetchWithRetry(model: any, prompt: string, maxRetries = 3, initialDelay = 1000) {
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await model.generateContent(prompt);
    } catch (error: any) {
      const isTemporaryError =
        error?.status === 503 ||
        error?.message?.includes("503") ||
        error?.message?.includes("high demand") ||
        error?.status === 429;

      if (isTemporaryError && attempt < maxRetries) {
        console.warn(`⚠️ [Gemini 503 Spike] 재시도 중... (${attempt}/${maxRetries}) - ${delay}ms 후 실행`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential Backoff (1초 -> 2초 -> 4초)
      } else {
        throw error;
      }
    }
  }
}

export async function POST() {
  try {
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!geminiKey) {
      return NextResponse.json(
        { success: false, error: "GEMINI_API_KEY가 .env.local에 설정되지 않았습니다." },
        { status: 400 }
      );
    }

    const handoffContent = getHandoffContent();
    const pageCodePath = path.join(process.cwd(), "src/app/page.tsx");

    if (!fs.existsSync(pageCodePath)) {
      return NextResponse.json(
        { success: false, error: "src/app/page.tsx 파일이 존재하지 않습니다." },
        { status: 404 }
      );
    }

    const pageCodeContent = fs.readFileSync(pageCodePath, "utf-8");

    const promptText = `너는 TASK_05 코드 검증 심사관이다.
아래 제공된 [HANDOFF DOCUMENT] 요구사항과 [SOURCE CODE IN IMPLEMENTATION]의 실제 구현 코드를 객관적이고 엄격하게 대조 분석하라.

검사 규칙:
1. TEST-01부터 TEST-10까지 각 항목에 대하여 소스코드 내 실제 로직 구현 여부를 정밀 판정하라.
2. 요구사항이 소스코드에 맞게 구현되어 동작한다고 판단되면 "PASSED", 구현되어 있지 않거나 미흡하면 "FAILED"로 평가하라.
3. 변수명이나 함수 구조가 조금 달라도 요구사항의 의도(예: Exponential Backoff, 자동 재시도 등)를 충족하면 객관적으로 PASSED 처리하라.

반드시 아래 JSON 스키마 규격으로만 응답하라:
{
  "testResults": [
    { "id": "TEST-01", "status": "PASSED 또는 FAILED", "reason": "판정 이유 한 줄 요약 (소스코드 근거 포함)" },
    { "id": "TEST-02", "status": "PASSED 또는 FAILED", "reason": "판정 이유 한 줄 요약 (소스코드 근거 포함)" },
    { "id": "TEST-03", "status": "PASSED 또는 FAILED", "reason": "판정 이유 한 줄 요약 (소스코드 근거 포함)" },
    { "id": "TEST-04", "status": "PASSED 또는 FAILED", "reason": "판정 이유 한 줄 요약 (소스코드 근거 포함)" },
    { "id": "TEST-05", "status": "PASSED 또는 FAILED", "reason": "판정 이유 한 줄 요약 (소스코드 근거 포함)" },
    { "id": "TEST-06", "status": "PASSED 또는 FAILED", "reason": "판정 이유 한 줄 요약 (소스코드 근거 포함)" },
    { "id": "TEST-07", "status": "PASSED 또는 FAILED", "reason": "판정 이유 한 줄 요약 (소스코드 근거 포함)" },
    { "id": "TEST-08", "status": "PASSED 또는 FAILED", "reason": "판정 이유 한 줄 요약 (소스코드 근거 포함)" },
    { "id": "TEST-09", "status": "PASSED 또는 FAILED", "reason": "판정 이유 한 줄 요약 (소스코드 근거 포함)" },
    { "id": "TEST-10", "status": "PASSED 또는 FAILED", "reason": "판정 이유 한 줄 요약 (소스코드 근거 포함)" }
  ]
}

[HANDOFF DOCUMENT]
${handoffContent}

[SOURCE CODE IN IMPLEMENTATION]
${pageCodeContent}`;

    // Gemini API 호출 (gemini-3.6-flash 고정)
    const genAI = new GoogleGenerativeAI(geminiKey);
    const geminiModel = genAI.getGenerativeModel({
      model: "gemini-3.6-flash",
      generationConfig: { responseMimeType: "application/json" },
    });

    // 백오프 재시도 포함 호출
    const geminiRes = await fetchWithRetry(geminiModel, promptText, 3, 1000);
    const geminiData = JSON.parse(geminiRes.response.text());

    const testResults = (geminiData.testResults || []).map((gItem: any) => ({
      id: gItem.id,
      geminiStatus: gItem.status,
      geminiReason: gItem.reason,
      status: gItem.status,
    }));

    const isAllPassed = testResults.every((item: any) => item.status === "PASSED");

    return NextResponse.json({
      success: true,
      executedBy: "Gemini Strict Checker (gemini-3.6-flash)",
      consensus: isAllPassed,
      data: {
        summary: isAllPassed
          ? "✅ Gemini 검증 결과 모든 항목이 통과되었습니다."
          : "⚠️ 미흡하거나 미구현된 테스트 항목이 존재합니다.",
        testResults,
      },
    });
  } catch (error: any) {
    console.error("💥 [VERIFY_ERROR]:", error.message);
    return NextResponse.json(
      { success: false, error: error.message || "검증 수행 실패" },
      { status: 500 }
    );
  }
}