import React, { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "track-manager-mode-switch-v8";
const MAX_RUNNERS = 6;

function formatTime(ms) {
  const safeMs = Math.max(0, ms || 0);
  const totalCs = Math.floor(safeMs / 10);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);
  return `${min}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function nowLocalInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function escapeCsv(value) {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function speakLap(runnerName, lapNo, splitMs, totalMs) {
  if (!("speechSynthesis" in window)) return;

  const synth = window.speechSynthesis;
  synth.cancel();

  const name = runnerName?.trim() || "選手";
  const text = `${name}、${lapNo}周目、ラップ ${formatTime(splitMs)}、累計 ${formatTime(totalMs)}`;

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ja-JP";
  utter.rate = 1.05;
  utter.pitch = 1.0;
  synth.speak(utter);
}

function createRunner(index) {
  return {
    id: `runner-${index + 1}`,
    lane: index + 1,
    name: "",
    eventName: "1500m",
    menu: "400m×5",
    memo: "",
    running: false,
    startAt: 0,
    accumulatedMs: 0,
    elapsedMs: 0,
    currentLapElapsedMs: 0,
    laps: [],
  };
}

function createDefaultRunners() {
  return Array.from({ length: MAX_RUNNERS }, (_, i) => createRunner(i));
}

export default function App() {
  const [sessionDate, setSessionDate] = useState(nowLocalInputValue());
  const [tab, setTab] = useState("timer");
  const [history, setHistory] = useState([]);
  const [runners, setRunners] = useState(createDefaultRunners());
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState("practice"); // practice | race
  const [raceRunning, setRaceRunning] = useState(false);

  const intervalRef = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved);

      if (Array.isArray(parsed.history)) {
        setHistory(parsed.history);
      }

      if (parsed.mode === "practice" || parsed.mode === "race") {
        setMode(parsed.mode);
      }

      if (Array.isArray(parsed.runners) && parsed.runners.length === MAX_RUNNERS) {
        setRunners(
          parsed.runners.map((runner, i) => ({
            ...createRunner(i),
            ...runner,
            lane: i + 1,
            running: false,
            startAt: 0,
            accumulatedMs: 0,
            elapsedMs: 0,
            currentLapElapsedMs: 0,
            laps: [],
          }))
        );
      }
    } catch (e) {
      console.error("load error", e);
    }
  }, []);

  useEffect(() => {
    const runnerSettings = runners.map((r) => ({
      id: r.id,
      lane: r.lane,
      name: r.name,
      eventName: r.eventName,
      menu: r.menu,
      memo: r.memo,
    }));

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        history,
        runners: runnerSettings,
        mode,
      })
    );
  }, [history, runners, mode]);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setRunners((prev) =>
        prev.map((runner) => {
          if (!runner.running) return runner;

          const totalElapsed = Date.now() - runner.startAt + runner.accumulatedMs;
          const previousLapTotal = runner.laps.length
            ? runner.laps[runner.laps.length - 1].totalMs
            : 0;
          const currentLapElapsed = totalElapsed - previousLapTotal;

          return {
            ...runner,
            elapsedMs: totalElapsed,
            currentLapElapsedMs: currentLapElapsed,
          };
        })
      );
    }, 10);

    return () => clearInterval(intervalRef.current);
  }, []);

  function updateRunner(id, key, value) {
    setRunners((prev) =>
      prev.map((runner) => (runner.id === id ? { ...runner, [key]: value } : runner))
    );
  }

  function startRunner(id) {
    if (mode !== "practice") return;

    setRunners((prev) =>
      prev.map((runner) => {
        if (runner.id !== id || runner.running) return runner;
        return {
          ...runner,
          running: true,
          startAt: Date.now(),
        };
      })
    );
  }

  function startRace() {
    if (mode !== "race" || raceRunning) return;

    const startTime = Date.now();
    setRaceRunning(true);

    setRunners((prev) =>
      prev.map((runner) => ({
        ...runner,
        running: true,
        startAt: startTime,
        accumulatedMs: 0,
        elapsedMs: 0,
        currentLapElapsedMs: 0,
        laps: [],
      }))
    );
  }

  function stopRunner(id) {
    setRunners((prev) =>
      prev.map((runner) => {
        if (runner.id !== id || !runner.running) return runner;

        const totalElapsed = Date.now() - runner.startAt + runner.accumulatedMs;
        const previousLapTotal = runner.laps.length
          ? runner.laps[runner.laps.length - 1].totalMs
          : 0;
        const currentLapElapsed = totalElapsed - previousLapTotal;

        return {
          ...runner,
          running: false,
          startAt: 0,
          accumulatedMs: totalElapsed,
          elapsedMs: totalElapsed,
          currentLapElapsedMs: currentLapElapsed,
        };
      })
    );
  }

  function stopAllRace() {
    if (mode !== "race") return;

    setRaceRunning(false);

    setRunners((prev) =>
      prev.map((runner) => {
        if (!runner.running) return runner;

        const totalElapsed = Date.now() - runner.startAt + runner.accumulatedMs;
        const previousLapTotal = runner.laps.length
          ? runner.laps[runner.laps.length - 1].totalMs
          : 0;
        const currentLapElapsed = totalElapsed - previousLapTotal;

        return {
          ...runner,
          running: false,
          startAt: 0,
          accumulatedMs: totalElapsed,
          elapsedMs: totalElapsed,
          currentLapElapsedMs: currentLapElapsed,
        };
      })
    );
  }

  function resetRunner(id) {
    setRunners((prev) =>
      prev.map((runner) => {
        if (runner.id !== id) return runner;
        return {
          ...runner,
          running: false,
          startAt: 0,
          accumulatedMs: 0,
          elapsedMs: 0,
          currentLapElapsedMs: 0,
          laps: [],
        };
      })
    );
  }

  function resetAll() {
    setRaceRunning(false);

    setRunners((prev) =>
      prev.map((runner) => ({
        ...runner,
        running: false,
        startAt: 0,
        accumulatedMs: 0,
        elapsedMs: 0,
        currentLapElapsedMs: 0,
        laps: [],
      }))
    );
  }

  function removeLastLap(id) {
    setRunners((prev) =>
      prev.map((runner) => {
        if (runner.id !== id) return runner;

        const nextLaps = runner.laps.slice(0, -1);
        const lastTotal = nextLaps.length ? nextLaps[nextLaps.length - 1].totalMs : 0;
        const currentLapElapsed = Math.max(0, runner.elapsedMs - lastTotal);

        return {
          ...runner,
          laps: nextLaps,
          currentLapElapsedMs: currentLapElapsed,
        };
      })
    );
  }

  function recordLap(id) {
    let speechPayload = null;

    setRunners((prev) =>
      prev.map((runner) => {
        if (runner.id !== id || !runner.running) return runner;

        const totalElapsed = Date.now() - runner.startAt + runner.accumulatedMs;
        const previousLapTotal = runner.laps.length
          ? runner.laps[runner.laps.length - 1].totalMs
          : 0;
        const split = totalElapsed - previousLapTotal;
        const lapNo = runner.laps.length + 1;

        speechPayload = {
          name: runner.name,
          lapNo,
          splitMs: split,
          totalMs: totalElapsed,
        };

        return {
          ...runner,
          elapsedMs: totalElapsed,
          currentLapElapsedMs: 0,
          laps: [
            ...runner.laps,
            {
              id: crypto.randomUUID(),
              lapNo,
              splitMs: split,
              totalMs: totalElapsed,
            },
          ],
        };
      })
    );

    setTimeout(() => {
      if (speechPayload) {
        speakLap(
          speechPayload.name,
          speechPayload.lapNo,
          speechPayload.splitMs,
          speechPayload.totalMs
        );
      }
    }, 0);
  }

  function saveRecord() {
    const activeRunners = runners.filter((r) => r.elapsedMs > 0 || r.laps.length > 0);

    if (!activeRunners.length) {
      alert("少なくとも1人は記録してください。");
      return;
    }

    const record = {
      id: crypto.randomUUID(),
      sessionDate,
      createdAt: new Date().toISOString(),
      mode,
      runners: activeRunners.map((runner) => ({
        id: runner.id,
        lane: runner.lane,
        name: runner.name,
        eventName: runner.eventName,
        menu: runner.menu,
        memo: runner.memo,
        totalMs: runner.elapsedMs,
        currentLapElapsedMs: runner.currentLapElapsedMs,
        laps: runner.laps,
      })),
    };

    setHistory((prev) => [record, ...prev]);
    alert("保存しました。");
  }

  function deleteRecord(id) {
    setHistory((prev) => prev.filter((item) => item.id !== id));
  }

  function exportCurrentCsv() {
    const rows = [
      [
        "モード",
        "日付",
        "レーン",
        "選手名",
        "種目",
        "メニュー",
        "経過タイム",
        "現在ラップ経過",
        "ラップ番号",
        "スプリット",
        "累計",
        "メモ",
      ],
    ];

    runners.forEach((runner) => {
      if (runner.laps.length === 0) {
        if (runner.elapsedMs > 0 || runner.name || runner.eventName || runner.menu || runner.memo) {
          rows.push([
            mode === "practice" ? "練習用" : "試合用",
            sessionDate,
            runner.lane,
            runner.name,
            runner.eventName,
            runner.menu,
            formatTime(runner.elapsedMs),
            formatTime(runner.currentLapElapsedMs),
            "",
            "",
            "",
            runner.memo,
          ]);
        }
      } else {
        runner.laps.forEach((lap) => {
          rows.push([
            mode === "practice" ? "練習用" : "試合用",
            sessionDate,
            runner.lane,
            runner.name,
            runner.eventName,
            runner.menu,
            formatTime(runner.elapsedMs),
            formatTime(runner.currentLapElapsedMs),
            lap.lapNo,
            formatTime(lap.splitMs),
            formatTime(lap.totalMs),
            runner.memo,
          ]);
        });
      }
    });

    downloadCsv("current-laps-mode-switch.csv", rows);
  }

  function exportHistoryCsv() {
    if (!history.length) {
      alert("履歴がありません。");
      return;
    }

    const rows = [
      [
        "モード",
        "日付",
        "保存日時",
        "レーン",
        "選手名",
        "種目",
        "メニュー",
        "総タイム",
        "保存時の現在ラップ経過",
        "ラップ番号",
        "スプリット",
        "累計",
        "メモ",
      ],
    ];

    history.forEach((record) => {
      record.runners.forEach((runner) => {
        if (!runner.laps.length) {
          rows.push([
            record.mode === "practice" ? "練習用" : "試合用",
            record.sessionDate,
            record.createdAt,
            runner.lane,
            runner.name,
            runner.eventName,
            runner.menu,
            formatTime(runner.totalMs),
            formatTime(runner.currentLapElapsedMs || 0),
            "",
            "",
            "",
            runner.memo,
          ]);
        } else {
          runner.laps.forEach((lap) => {
            rows.push([
              record.mode === "practice" ? "練習用" : "試合用",
              record.sessionDate,
              record.createdAt,
              runner.lane,
              runner.name,
              runner.eventName,
              runner.menu,
              formatTime(runner.totalMs),
              formatTime(runner.currentLapElapsedMs || 0),
              lap.lapNo,
              formatTime(lap.splitMs),
              formatTime(lap.totalMs),
              runner.memo,
            ]);
          });
        }
      });
    });

    downloadCsv("lap-history-mode-switch.csv", rows);
  }

  const styles = {
    app: {
      fontFamily: "Arial, sans-serif",
      maxWidth: 1500,
      margin: "0 auto",
      padding: 10,
      background: "#f4f6fb",
      minHeight: "100vh",
    },
    title: {
      fontSize: 26,
      fontWeight: "bold",
      marginBottom: 4,
    },
    subtitle: {
      color: "#555",
      marginBottom: 12,
      fontSize: 14,
    },
    tabs: {
      display: "flex",
      gap: 8,
      marginBottom: 12,
      flexWrap: "wrap",
    },
    tabBtn: (active) => ({
      padding: "10px 14px",
      borderRadius: 12,
      border: "1px solid #ccc",
      background: active ? "#111827" : "#fff",
      color: active ? "#fff" : "#111",
      fontWeight: "bold",
      cursor: "pointer",
    }),
    topBar: {
      background: "#fff",
      borderRadius: 16,
      padding: 12,
      marginBottom: 12,
      border: "1px solid #ddd",
      boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
    },
    topBarGrid: {
      display: "grid",
      gridTemplateColumns: "220px 140px 1fr 1fr 1fr 1fr 1fr",
      gap: 8,
      alignItems: "end",
    },
    label: {
      display: "block",
      fontSize: 12,
      fontWeight: "bold",
      marginBottom: 4,
    },
    input: {
      width: "100%",
      padding: 8,
      borderRadius: 10,
      border: "1px solid #ccc",
      boxSizing: "border-box",
      fontSize: 14,
      marginBottom: 6,
    },
    select: {
      width: "100%",
      padding: 8,
      borderRadius: 10,
      border: "1px solid #ccc",
      boxSizing: "border-box",
      fontSize: 14,
      background: "#fff",
    },
    button: (bg = "#e5e7eb", color = "#111", disabled = false) => ({
      width: "100%",
      border: "none",
      borderRadius: 12,
      padding: "14px 8px",
      fontSize: 15,
      fontWeight: "bold",
      background: disabled ? "#d1d5db" : bg,
      color,
      cursor: disabled ? "not-allowed" : "pointer",
    }),
    laneGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: 8,
    },
    laneCard: {
      background: "#fff",
      border: "1px solid #dbe2ea",
      borderRadius: 16,
      padding: 8,
      boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
    },
    laneTop: {
      display: "grid",
      gridTemplateColumns: "44px 1fr 1fr 68px",
      gap: 6,
      alignItems: "center",
      marginBottom: 6,
    },
    laneBadge: {
      background: "#e0e7ff",
      color: "#3730a3",
      borderRadius: 12,
      textAlign: "center",
      padding: "8px 4px",
      fontWeight: "bold",
      fontSize: 13,
    },
    timerBox: {
      background: "#111827",
      color: "#fff",
      borderRadius: 12,
      padding: "8px 6px",
      textAlign: "center",
    },
    timerLabel: {
      fontSize: 10,
      opacity: 0.85,
      marginBottom: 2,
    },
    timerValue: {
      fontWeight: "bold",
      fontSize: 20,
      letterSpacing: 1,
    },
    statusBox: (running) => ({
      background: running ? "#dcfce7" : "#f3f4f6",
      color: running ? "#166534" : "#374151",
      borderRadius: 12,
      padding: "8px 4px",
      textAlign: "center",
      fontWeight: "bold",
      fontSize: 12,
    }),
    compactGrid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 6,
    },
    practiceButtons: {
      display: "grid",
      gridTemplateColumns: "1fr 1.4fr 1fr 0.9fr",
      gap: 6,
      marginTop: 4,
      marginBottom: 6,
    },
    raceButtons: {
      display: "grid",
      gridTemplateColumns: "2.4fr 0.9fr 0.9fr",
      gap: 6,
      marginTop: 4,
      marginBottom: 6,
    },
    raceLapButton: {
      width: "100%",
      border: "none",
      borderRadius: 14,
      padding: "22px 8px",
      fontSize: 24,
      fontWeight: "bold",
      background: "#2563eb",
      color: "#fff",
      cursor: "pointer",
    },
    raceLapButtonDisabled: {
      width: "100%",
      border: "none",
      borderRadius: 14,
      padding: "22px 8px",
      fontSize: 24,
      fontWeight: "bold",
      background: "#93c5fd",
      color: "#fff",
      cursor: "not-allowed",
    },
    smallRaceButton: (bg = "#e5e7eb", color = "#111", disabled = false) => ({
      width: "100%",
      border: "none",
      borderRadius: 12,
      padding: "12px 6px",
      fontSize: 14,
      fontWeight: "bold",
      background: disabled ? "#d1d5db" : bg,
      color,
      cursor: disabled ? "not-allowed" : "pointer",
    }),
    tableWrap: {
      maxHeight: 170,
      overflowY: "auto",
      overflowX: "auto",
      border: "1px solid #e5e7eb",
      borderRadius: 12,
      marginTop: 4,
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
    },
    thtd: {
      borderBottom: "1px solid #e5e7eb",
      padding: 6,
      textAlign: "left",
      fontSize: 12,
      whiteSpace: "nowrap",
    },
    subInfo: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 6,
      marginTop: 6,
      fontSize: 12,
      color: "#555",
    },
    recordBox: {
      background: "#fff",
      border: "1px solid #ddd",
      borderRadius: 14,
      padding: 12,
      marginBottom: 12,
    },
    badge: {
      display: "inline-block",
      marginRight: 6,
      marginBottom: 6,
      padding: "4px 8px",
      borderRadius: 999,
      background: "#eef2ff",
      color: "#3730a3",
      fontSize: 12,
      fontWeight: "bold",
    },
    small: {
      fontSize: 12,
      color: "#666",
    },
  };

  return (
    <div style={styles.app}>
      <div style={styles.title}>陸上部マネージャー用 ラップ記録アプリ</div>
      <div style={styles.subtitle}>
        練習用は個別スタート、試合用は全員同時スタート。試合用はラップボタンを大きくしています。
      </div>

      <div style={styles.tabs}>
        <button style={styles.tabBtn(tab === "timer")} onClick={() => setTab("timer")}>
          計測
        </button>
        <button style={styles.tabBtn(tab === "history")} onClick={() => setTab("history")}>
          履歴
        </button>
      </div>

      {tab === "timer" && (
        <>
          <div style={styles.topBar}>
            <div style={styles.topBarGrid}>
              <div>
                <label style={styles.label}>日時</label>
                <input
                  style={styles.input}
                  type="datetime-local"
                  value={sessionDate}
                  onChange={(e) => setSessionDate(e.target.value)}
                />
              </div>

              <div>
                <label style={styles.label}>モード</label>
                <select
                  style={styles.select}
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value);
                    resetAll();
                  }}
                >
                  <option value="practice">練習用</option>
                  <option value="race">試合用</option>
                </select>
              </div>

              <div>
                <button
                  style={styles.button("#334155", "#fff")}
                  onClick={() => setShowSettings((prev) => !prev)}
                >
                  {showSettings ? "入力欄を隠す" : "入力欄を表示"}
                </button>
              </div>

              {mode === "race" ? (
                <div>
                  <button
                    style={styles.button("#16a34a", "#fff", raceRunning)}
                    onClick={startRace}
                    disabled={raceRunning}
                  >
                    全員同時スタート
                  </button>
                </div>
              ) : (
                <div>
                  <button style={styles.button("#64748b", "#fff", true)} disabled>
                    個別スタート式
                  </button>
                </div>
              )}

              <div>
                <button
                  style={styles.button(
                    mode === "race" ? "#f59e0b" : "#dc2626",
                    "#fff",
                    mode === "race" ? !raceRunning : false
                  )}
                  onClick={mode === "race" ? stopAllRace : resetAll}
                  disabled={mode === "race" ? !raceRunning : false}
                >
                  {mode === "race" ? "全員停止" : "全員リセット"}
                </button>
              </div>

              <div>
                <button style={styles.button("#111827", "#fff")} onClick={saveRecord}>
                  記録を保存
                </button>
              </div>

              <div>
                <button style={styles.button("#2563eb", "#fff")} onClick={exportCurrentCsv}>
                  CSV出力
                </button>
              </div>
            </div>
          </div>

          <div style={styles.laneGrid}>
            {runners.map((runner) => (
              <div key={runner.id} style={styles.laneCard}>
                <div style={styles.laneTop}>
                  <div style={styles.laneBadge}>L{runner.lane}</div>

                  <div style={styles.timerBox}>
                    <div style={styles.timerLabel}>経過</div>
                    <div style={styles.timerValue}>{formatTime(runner.elapsedMs)}</div>
                  </div>

                  <div style={styles.timerBox}>
                    <div style={styles.timerLabel}>現在ラップ</div>
                    <div style={styles.timerValue}>{formatTime(runner.currentLapElapsedMs)}</div>
                  </div>

                  <div style={styles.statusBox(runner.running)}>
                    {runner.running ? "計測中" : "停止中"}
                  </div>
                </div>

                {showSettings && (
                  <>
                    <div style={styles.compactGrid}>
                      <div>
                        <label style={styles.label}>選手名</label>
                        <input
                          style={styles.input}
                          value={runner.name}
                          onChange={(e) => updateRunner(runner.id, "name", e.target.value)}
                          placeholder="選手名"
                        />
                      </div>
                      <div>
                        <label style={styles.label}>種目</label>
                        <input
                          style={styles.input}
                          value={runner.eventName}
                          onChange={(e) => updateRunner(runner.id, "eventName", e.target.value)}
                          placeholder="1500m"
                        />
                      </div>
                    </div>

                    <div style={styles.compactGrid}>
                      <div>
                        <label style={styles.label}>メニュー</label>
                        <input
                          style={styles.input}
                          value={runner.menu}
                          onChange={(e) => updateRunner(runner.id, "menu", e.target.value)}
                          placeholder="400m×5"
                        />
                      </div>
                      <div>
                        <label style={styles.label}>メモ</label>
                        <input
                          style={styles.input}
                          value={runner.memo}
                          onChange={(e) => updateRunner(runner.id, "memo", e.target.value)}
                          placeholder="補足"
                        />
                      </div>
                    </div>
                  </>
                )}

                {mode === "practice" ? (
                  <div style={styles.practiceButtons}>
                    <button
                      style={styles.button("#16a34a", "#fff", runner.running)}
                      onClick={() => startRunner(runner.id)}
                      disabled={runner.running}
                    >
                      開始
                    </button>

                    <button
                      style={styles.button("#2563eb", "#fff", !runner.running)}
                      onClick={() => recordLap(runner.id)}
                      disabled={!runner.running}
                    >
                      ラップ
                    </button>

                    <button
                      style={styles.button("#f59e0b", "#fff", !runner.running)}
                      onClick={() => stopRunner(runner.id)}
                      disabled={!runner.running}
                    >
                      停止
                    </button>

                    <button
                      style={styles.button("#ef4444", "#fff")}
                      onClick={() => resetRunner(runner.id)}
                    >
                      消去
                    </button>
                  </div>
                ) : (
                  <div style={styles.raceButtons}>
                    <button
                      style={runner.running ? styles.raceLapButton : styles.raceLapButtonDisabled}
                      onClick={() => recordLap(runner.id)}
                      disabled={!runner.running}
                    >
                      ラップ
                    </button>

                    <button
                      style={styles.smallRaceButton("#f59e0b", "#fff", !runner.running)}
                      onClick={() => stopRunner(runner.id)}
                      disabled={!runner.running}
                    >
                      停止
                    </button>

                    <button
                      style={styles.smallRaceButton("#ef4444", "#fff", false)}
                      onClick={() => resetRunner(runner.id)}
                    >
                      消去
                    </button>
                  </div>
                )}

                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.thtd}>Lap</th>
                        <th style={styles.thtd}>Split</th>
                        <th style={styles.thtd}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runner.laps.length === 0 ? (
                        <tr>
                          <td style={styles.thtd} colSpan={3}>
                            まだラップはありません
                          </td>
                        </tr>
                      ) : (
                        runner.laps.map((lap) => (
                          <tr key={lap.id}>
                            <td style={styles.thtd}>{lap.lapNo}</td>
                            <td style={styles.thtd}>{formatTime(lap.splitMs)}</td>
                            <td style={styles.thtd}>{formatTime(lap.totalMs)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div style={styles.subInfo}>
                  <div>
                    最新ラップ:{" "}
                    {runner.laps.length
                      ? formatTime(runner.laps[runner.laps.length - 1].splitMs)
                      : "-"}
                  </div>
                  <div>周回数: {runner.laps.length}</div>
                </div>

                <div style={{ marginTop: 6 }}>
                  <button
                    style={styles.button("#e5e7eb", "#111", runner.laps.length === 0)}
                    onClick={() => removeLastLap(runner.id)}
                    disabled={runner.laps.length === 0}
                  >
                    1つ戻す
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "history" && (
        <div>
          <div style={{ marginBottom: 12 }}>
            <button
              style={styles.button("#111827", "#fff", !history.length)}
              onClick={exportHistoryCsv}
              disabled={!history.length}
            >
              履歴をCSV出力
            </button>
          </div>

          {history.length === 0 ? (
            <div style={styles.recordBox}>保存された履歴はありません。</div>
          ) : (
            history.map((record) => (
              <div key={record.id} style={styles.recordBox}>
                <div style={{ fontWeight: "bold", marginBottom: 6 }}>
                  {record.mode === "practice" ? "練習用" : "試合用"} / 日時: {record.sessionDate}
                </div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                  保存日時: {record.createdAt}
                </div>

                {record.runners.map((runner) => (
                  <div
                    key={`${record.id}-${runner.id}`}
                    style={{
                      padding: 10,
                      border: "1px solid #eee",
                      borderRadius: 10,
                      background: "#fafafa",
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ marginBottom: 6 }}>
                      <span style={styles.badge}>Lane {runner.lane}</span>
                      <span style={styles.badge}>{runner.name || "未入力"}</span>
                      <span style={styles.badge}>{runner.eventName}</span>
                      <span style={styles.badge}>{runner.menu}</span>
                    </div>

                    <div style={styles.small}>総タイム: {formatTime(runner.totalMs)}</div>
                    <div style={styles.small}>
                      保存時の現在ラップ経過: {formatTime(runner.currentLapElapsedMs || 0)}
                    </div>
                    {runner.memo ? <div style={styles.small}>メモ: {runner.memo}</div> : null}

                    <div style={styles.tableWrap}>
                      <table style={styles.table}>
                        <thead>
                          <tr>
                            <th style={styles.thtd}>Lap</th>
                            <th style={styles.thtd}>Split</th>
                            <th style={styles.thtd}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {runner.laps.length === 0 ? (
                            <tr>
                              <td style={styles.thtd} colSpan={3}>
                                ラップなし
                              </td>
                            </tr>
                          ) : (
                            runner.laps.map((lap) => (
                              <tr key={lap.id}>
                                <td style={styles.thtd}>{lap.lapNo}</td>
                                <td style={styles.thtd}>{formatTime(lap.splitMs)}</td>
                                <td style={styles.thtd}>{formatTime(lap.totalMs)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                <button
                  style={styles.button("#dc2626", "#fff")}
                  onClick={() => deleteRecord(record.id)}
                >
                  この記録を削除
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
