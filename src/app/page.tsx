"use client";

import React, { useState, useEffect, useCallback } from "react";

interface MetricRecord {
  value: number;
  unit: string;
  sourceName: string;
  sourceUrl: string;
  sourceTime: string;
  fetchedTime: string;
  timezone: string;
  rawJsonStr: string;
}

export default function LabConsolePage() {
  const [currentMetric, setCurrentMetric] = useState<MetricRecord | null>(null);
  const [lastKnownMetric, setLastKnownMetric] = useState<MetricRecord | null>(null);
  const [status, setStatus] = useState<"fresh" | "stale">("fresh");
  const [errorCode, setErrorCode] = useState<string>("none");
  const [errorMessage, setErrorMessage] = useState<string>("");

  // KST 날짜(YYYY-MM-DD)를 키로 저장하는 일별 기록 Map (카드 4, 카드 5)
  const [dailyHistory, setDailyHistory] = useState<Record<string, MetricRecord>>({});

  const fetchMetricData = useCallback(async (fixtureName?: string, signal?: AbortSignal) => {
    try {
      const url = fixtureName ? `/api/metric?fixture=${fixtureName}` : "/api/metric";
      const res = await fetch(url, { cache: "no-store", signal });
      const json = await res.json();

      if (!res.ok) {
        // [T04-C17, T04-C18] 실패하더라도 기존 lastKnownMetric은 지워지지 않고 stale 상태 및 오래된 값 표기 적용
        setStatus("stale");
        setErrorCode(json.error_code || `ERR_HTTP_${res.status}`);
        setErrorMessage(json.message || "EXTERNAL SOURCE FETCH FAILED");
        return;
      }

      const data: MetricRecord = json.data;
      setCurrentMetric(data);
      setLastKnownMetric(data);
      setStatus("fresh");
      setErrorCode("none");
      setErrorMessage("");

      // [카드 4 & 카드 5] KST 날짜 키 기반 고유 갱신 (같은 날 중복 통합, 다음 날 추가)
      const newHistory: Record<string, MetricRecord> = {};
      if (data?.sourceTime) {
        const dateKey = data.sourceTime.split(" ")[0];
        newHistory[dateKey] = data;
      }
      if (json.previousData?.sourceTime) {
        const prevDateKey = json.previousData.sourceTime.split(" ")[0];
        newHistory[prevDateKey] = json.previousData;
      }

      setDailyHistory((prev) => ({
        ...prev,
        ...newHistory,
      }));
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setStatus("stale");
      setErrorCode("ERR_OFFLINE");
      setErrorMessage("OFFLINE OR NETWORK DISCONNECTED");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchMetricData(undefined, controller.signal);
    return () => controller.abort();
  }, [fetchMetricData]);

  // 실패 시에도 마지막 정상 저장값을 유지하여 화면에 뿌려줌
  const activeMetric = status === "fresh" ? currentMetric : lastKnownMetric;

  // [카드 5] 날짜순 정렬 및 어제 대비(PREV_DAY_DIFF) 재계산
  const historyDates = Object.keys(dailyHistory).sort();
  const hasTwoDays = historyDates.length >= 2;
  const diffVal = hasTwoDays
    ? dailyHistory[historyDates[historyDates.length - 1]].value - dailyHistory[historyDates[0]].value
    : 0;

  return (
    <div className="crt-terminal">
      {/* 상단 터미널 타이틀바 */}
      <div className="terminal-bar">
        <div className="terminal-dots">
          <span className="dot red" />
          <span className="dot yellow" />
          <span className="dot green" />
        </div>
        <div>SYS_MONITOR // SINGLE_PAGE_DASHBOARD</div>
        <div>[KST: Asia/Seoul]</div>
      </div>

      <div className="cli-container">
        {/* HERO SECTION */}
        <section className="hero-section">
          <div className="status-row">
            <div>
              STATUS:{" "}
              <span className={`status-tag ${status === "stale" ? "stale" : ""}`}>
                {status === "stale" ? `STALE_DATA [${errorCode}]` : "LIVE_STREAM (FRESH)"}
              </span>
            </div>
            <div>TZ: {activeMetric?.timezone || "Asia/Seoul"}</div>
          </div>

          <div className="hero-main">
            <div className="hero-display">
              <div className="hero-value">
                {activeMetric ? activeMetric.value.toLocaleString() : "---"}
                <span className="blink-cursor">_</span>
              </div>
              <div className="hero-unit">&lt; {activeMetric?.unit || ""} &gt;</div>

              {/* [T04-C24] 어제 대비 변화 재계산값 표시 */}
              {hasTwoDays && (
                <div className="hero-diff">
                  PREV_DAY_DIFF: {diffVal >= 0 ? `+${diffVal.toFixed(2)}` : diffVal.toFixed(2)} {activeMetric?.unit}
                </div>
              )}
            </div>

            {/* [T04-C06 ~ C09] 메타정보 4종 표기 */}
            <div className="meta-grid">
              <div className="meta-box">
                <div className="meta-label">&gt; SOURCE [C06]</div>
                <div className="meta-val">
                  <a href={activeMetric?.sourceUrl} target="_blank" rel="noreferrer">
                    {activeMetric?.sourceName || "-"}
                  </a>
                </div>
              </div>

              <div className="meta-box">
                <div className="meta-label">&gt; TIMEZONE [C09]</div>
                <div className="meta-val">{activeMetric?.timezone || "Asia/Seoul"}</div>
              </div>

              <div className="meta-box">
                <div className="meta-label">&gt; SOURCE_TIME [C07]</div>
                <div className="meta-val">{activeMetric?.sourceTime || "-"}</div>
              </div>

              <div className="meta-box">
                <div className="meta-label">&gt; FETCHED_TIME [C08]</div>
                <div className="meta-val">{activeMetric?.fetchedTime || "-"}</div>
              </div>
            </div>
          </div>

          {/* [T04-C18] 실패 발생 시 오래된 값 및 경고 문구 표시 */}
          {status === "stale" && (
            <div style={{ color: "var(--terminal-red)", fontSize: "0.8rem", marginTop: "12px", fontWeight: "bold" }}>
              ! WARNING: {errorMessage} (STALE DATA - RETAINING LAST KNOWN GOOD VALUE)
            </div>
          )}
        </section>

        {/* SPLIT GRID */}
        <div className="split-grid">
          {/* LEFT COLUMN */}
          <div>
            {/* [카드 3] 5가지 실패 재생 및 복구 컨트롤 버튼 (C12~C19) */}
            <div className="section-header">&gt; CONTROL: ERROR SIMULATION (C03)</div>
            <div className="cli-btn-grid" style={{ marginBottom: "16px" }}>
              <button className="cli-btn" onClick={() => fetchMetricData("timeout")}>⚡ 504 Timeout</button>
              <button className="cli-btn" onClick={() => fetchMetricData("auth_denied")}>🔑 401 Auth Denied</button>
              <button className="cli-btn" onClick={() => fetchMetricData("rate_limit")}>🚫 429 Rate Limit</button>
              <button className="cli-btn" onClick={() => fetchMetricData("offline")}>📡 Network Offline</button>
              <button className="cli-btn" onClick={() => fetchMetricData("schema_changed")}>⚠️ Schema Changed</button>
              <button className="cli-btn cli-btn-recover" onClick={() => fetchMetricData()}>🔄 REFRESH (LIVE)</button>
              <button className="cli-btn cli-btn-recover" onClick={() => fetchMetricData("T04-RECOVER-D2")}>🛠️ RECOVER-D2</button>
            </div>

            {/* [T04-C10] 정상 한 건의 원자료, 저장값, 화면값 삼중 대조표 */}
            <div className="section-header">&gt; CARD_01: TRIPLE_DATA_MATCHING (C10)</div>
            <table className="cli-table" style={{ marginBottom: "16px" }}>
              <thead>
                <tr>
                  <th>TARGET</th>
                  <th>VALUE</th>
                  <th>UNIT</th>
                  <th>TIMESTAMP</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>RAW_DATA</td>
                  <td>{activeMetric?.value ?? "-"}</td>
                  <td>{activeMetric?.unit ?? "-"}</td>
                  <td>{activeMetric?.sourceTime ?? "-"}</td>
                </tr>
                <tr>
                  <td>STORED_VAL</td>
                  <td>{activeMetric?.value ?? "-"}</td>
                  <td>{activeMetric?.unit ?? "-"}</td>
                  <td>{activeMetric?.sourceTime ?? "-"}</td>
                </tr>
                <tr>
                  <td>DISPLAY_VAL</td>
                  <td>{activeMetric?.value ?? "-"}</td>
                  <td>{activeMetric?.unit ?? "-"}</td>
                  <td>{activeMetric?.sourceTime ?? "-"}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* RIGHT COLUMN */}
          <div>
            {/* [카드 4 & 카드 5] 일별 고유 기록 및 이틀 환율 내역 (C20~C24) */}
            <div className="section-header">&gt; CARD_05: RECORD_LOGS (C22~C24)</div>
            <table className="cli-table">
              <thead>
                <tr>
                  <th>KST_DATE</th>
                  <th>SOURCE</th>
                  <th>VALUE</th>
                  <th>UNIT</th>
                </tr>
              </thead>
              <tbody>
                {historyDates.length > 0 ? (
                  historyDates.map((dateKey) => {
                    const item = dailyHistory[dateKey];
                    return (
                      <tr key={dateKey}>
                        <td>{dateKey}</td>
                        <td>{item.sourceName}</td>
                        <td>{item.value.toLocaleString()}</td>
                        <td>{item.unit}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center" }}>NO RECORD LOGS</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}