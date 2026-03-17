import React, { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "track-manager-3mode-v12";
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

function formatTimeForSpeech(ms) {
  const safeMs = Math.max(0, ms || 0);
  const totalCs = Math.floor(safeMs / 10);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);

  if (min > 0) {
    return `${min}分${sec}秒${String(cs).padStart(2, "0")}`;
  }
  return `${sec}秒${String(cs).padStart(2, "0")}`;
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

function getJapaneseVoice(voices) {
  if (!voices || !voices.length) return null;
  return (
    voices.find((v) => v.lang === "ja-JP") ||
    voices.find((v) => v.lang?.startsWith("ja")) ||
    null
  );
}

function speakLap(voice, runnerName, lane, lapNo, splitMs, totalMs) {
  if (!("speechSynthesis" in window)) return;

  const synth = window.speechSynthesis;
  synth.cancel();

  const displayName = runnerName?.trim() ? runnerName.trim() : `レーン${lane}`;
  const splitText = formatTimeForSpeech(splitMs);
  const totalText = formatTimeForSpeech(totalMs);
  const text = `${displayName}、${lapNo}周目、ラップ${splitText}、累計${totalText}`;

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ja-JP";
  utter.rate = 1.0;
  utter.pitch = 1.0;
  if (voice) utter.voice = voice;
  synth.speak(utter);
}

export default function App() {
  const [sessionDate, setSessionDate] = useState(nowLocalInputValue());
  const [tab, setTab] = useState("timer");
  const [history, setHistory] = useState([]);
  const [runners, setRunners] = useState(createDefaultRunners());
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState("practice"); // practice | race | race_focus
  const [raceRunning, setRaceRunning] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [voices, setVoices] = useState([]);

  const intervalRef = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved);

      if (Array.isArray(parsed.history)) {
        setHistory(parsed.history);
      }

      if (["practice", "race", "race_focus"].includes(parsed.mode)) {
        setMode(parsed.mode);
      }

      if (typeof parsed.speechEnabled === "boolean") {
        setSpeechEnabled(parsed.speechEnabled);
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
        speechEnabled,
      })
    );
  }, [history, runners, mode, speechEnabled]);

  useEffect(() => {
    function loadVoices() {
      setVoices(window.speechSynthesis?.getVoices?.() || []);
    }

    loadVoices();

    if ("speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  const japaneseVoice = useMemo(() => getJapaneseVoice(voices), [voices]);

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
    if (!["race", "race_focus"].includes(mode) || raceRunning) return;

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
    if (!["race", "race_focus"].includes(mode)) return;

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
          lane: runner.lane,
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
      if (speechEnabled && speechPayload) {
        speakLap(
          japaneseVoice,
          speechPayload.name,
          speechPayload.lane,
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
    const modeName =
      mode === "practice"
        ? "練習用"
        : mode === "race"
          ? "試合用"
          : "試合特化用";

    const rows = [
      [
        "モード",
        "日付",
        "レーン",
        "表示名",
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
      const displayName = `L${runner.lane}${runner.name ? ` ${runner.name}` : ""}`;

      if (runner.laps.length === 0) {
        if (runner.elapsedMs > 0 || runner.name || runner.eventName || runner.menu || runner.memo) {
          rows.push([
            modeName,
            sessionDate,
            runner.lane,
            displayName,
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
            modeName,
            sessionDate,
            runner.lane,
            displayName,
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

    downloadCsv("current-laps-3mode.csv", rows);
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
        "表示名",
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
      const modeName =
        record.mode === "practice"
          ? "練習用"
          : record.mode === "race"
            ? "試合用"
            : "試合特化用";

      record.runners.forEach((runner) => {
        const displayName = `L${runner.lane}${runner.name ? ` ${runner.name}` : ""}`;

        if (!runner.laps.length) {
          rows.push([
            modeName,
            record.sessionDate,
            record.createdAt,
            runner.lane,
            displayName,
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
              modeName,
              record.sessionDate,
              record.createdAt,
              runner.lane,
              displayName,
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

    downloadCsv("lap-history-3mode.csv", rows);
  }

  function laneLabel(runner) {
    return `L${runner.lane}${runner.name ? ` ${runner.name}` : ""}`;
  }

  function renderNormalCard(runner) {
    return (
      <>
        <div style={styles.laneTop}>
          <div style={styles.laneBadge}>{laneLabel(runner)}</div>

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
      </>
    );
  }

  function renderRaceFocusCard(runner) {
    return (
      <>
        <div style={styles.focusTop}>
          <div style={styles.focusLane}>{laneLabel(runner)}</div>
          <div style={styles.focusTimer}>
            <div style={styles.focusTimerLabel}>経過</div>
            <div style={styles.focusTimerValue}>{formatTime(runner.elapsedMs)}</div>
          </div>
          <div style={styles.focusTimer}>
            <div style={styles.focusTimerLabel}>現在ラップ</div>
            <div style={styles.focusTimerValue}>{formatTime(runner.currentLapElapsedMs)}</div>
          </div>
        </div>

        <div style={styles.focusButtons}>
          <button
            style={runner.running ? styles.focusLapButton : styles.focusLapButtonDisabled}
            onClick={() => recordLap(runner.id)}
            disabled={!runner.running}
          >
            ラップ
          </button>
          <button
            style={styles.focusSmallButton("#f59e0b", "#fff", !runner.running)}
            onClick={() => stopRunner(runner.id)}
            disabled={!runner.running}
          >
            停止
          </button>
          <button
            style={styles.focusSmallButton("#ef4444", "#fff", false)}
            onClick={() => resetRunner(runner.id)}
          >
            消去
          </button>
        </div>

        <div style={styles.focusBottomInfo}>
          <div>
            最新:{" "}
            {runner.laps.length
              ? formatTime(runner.laps[runner.laps.length - 1].splitMs)
              : "-"}
          </div>
          <div>周回: {runner.laps.length}</div>
          <div>{runner.running ? "計測中" : "停止中"}</div>
        </div>
      </>
    );
  }

  const visibleRunners = mode === "race_focus" ? runners.slice(0, 4) : runners;

  const styles = {
    app: {
      fontFamily: "Arial, sans-serif",
      maxWidth: 1400,
      margin: "0 auto",
      padding: 10,
      background: "#f4f6fb",
      minHeight: "100vh",
      boxSizing: "border-box",
    },
    title: {
      fontSize: 24,
      fontWeight: "bold",
      marginBottom: 4,
    },
    subtitle: {
      color: "#555",
      marginBottom: 12,
      fontSize: 13,
      lineHeight: 1.5,
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
      flex: "1 1 140px",
    }),
    topBar: {
      background: "#fff",
      borderRadius: 16,
      padding: 10,
      marginBottom: 12,
      border: "1px solid #ddd",
      boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
    },
    topBarGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
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
      padding: 10,
      borderRadius: 10,
      border: "1px solid #ccc",
      boxSizing: "border-box",
      fontSize: 16,
      marginBottom: 6,
      background: "#fff",
    },
    select: {
      width: "100%",
      padding: 10,
      borderRadius: 10,
      border: "1px solid #ccc",
      boxSizing: "border-box",
      fontSize: 16,
      background: "#fff",
    },
    button: (bg = "#e5e7eb", color = "#111", disabled = false) => ({
      width: "100%",
      border: "none",
      borderRadius: 12,
      padding: "14px 10px",
      fontSize: 15,
      fontWeight: "bold",
      background: disabled ? "#d1d5db" : bg,
      color,
      cursor: disabled ? "not-allowed" : "pointer",
      minHeight: 48,
    }),
    laneGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
      gap: 10,
    },
    laneCard: {
      background: "#fff",
      border: "1px solid #dbe2ea",
      borderRadius: 16,
      padding: 10,
      boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
      boxSizing: "border-box",
    },
    laneTop: {
      display: "grid",
      gridTemplateColumns: "110px 1fr 1fr 62px",
      gap: 6,
      alignItems: "stretch",
      marginBottom: 8,
    },
    laneBadge: {
      background: "#e0e7ff",
      color: "#3730a3",
      borderRadius: 12,
      textAlign: "center",
      padding: "8px 6px",
      fontWeight: "bold",
      fontSize: 13,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: 1.2,
      wordBreak: "break-word",
    },
    timerBox: {
      background: "#111827",
      color: "#fff",
      borderRadius: 12,
      padding: "8px 6px",
      textAlign: "center",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      minHeight: 58,
    },
    timerLabel: {
      fontSize: 10,
      opacity: 0.85,
      marginBottom: 2,
    },
    timerValue: {
      fontWeight: "bold",
      fontSize: 20,
      letterSpacing: 0.5,
      whiteSpace: "nowrap",
    },
    statusBox: (running) => ({
      background: running ? "#dcfce7" : "#f3f4f6",
      color: running ? "#166534" : "#374151",
      borderRadius: 12,
      padding: "8px 4px",
      textAlign: "center",
      fontWeight: "bold",
      fontSize: 12,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: 58,
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
      marginTop: 6,
      marginBottom: 8,
    },
    raceButtons: {
      display: "grid",
      gridTemplateColumns: "2fr 0.95fr 0.95fr",
      gap: 6,
      marginTop: 6,
      marginBottom: 8,
    },
    raceLapButton: {
      width: "100%",
      border: "none",
      borderRadius: 14,
      padding: "18px 8px",
      fontSize: 22,
      fontWeight: "bold",
      background: "#2563eb",
      color: "#fff",
      cursor: "pointer",
      minHeight: 62,
    },
    raceLapButtonDisabled: {
      width: "100%",
      border: "none",
      borderRadius: 14,
      padding: "18px 8px",
      fontSize: 22,
      fontWeight: "bold",
      background: "#93c5fd",
      color: "#fff",
      cursor: "not-allowed",
      minHeight: 62,
    },
    smallRaceButton: (bg = "#e5e7eb", color = "#111", disabled = false) => ({
      width: "100%",
      border: "none",
      borderRadius: 12,
      padding: "10px 6px",
      fontSize: 14,
      fontWeight: "bold",
      background: disabled ? "#d1d5db" : bg,
      color,
      cursor: disabled ? "not-allowed" : "pointer",
      minHeight: 62,
    }),
    tableWrap: {
      maxHeight: 190,
      overflowY: "auto",
      overflowX: "auto",
      border: "1px solid #e5e7eb",
      borderRadius: 12,
      marginTop: 4,
      background: "#fff",
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      minWidth: 250,
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
      marginTop: 8,
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

    focusTop: {
      display: "grid",
      gridTemplateColumns: "120px 1fr 1fr",
      gap: 8,
      marginBottom: 10,
      alignItems: "stretch",
    },
    focusLane: {
      background: "#e0e7ff",
      color: "#3730a3",
      borderRadius: 14,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: "bold",
      fontSize: 20,
      minHeight: 78,
      padding: "6px",
      textAlign: "center",
      lineHeight: 1.2,
      wordBreak: "break-word",
    },
    focusTimer: {
      background: "#0f172a",
      color: "#fff",
      borderRadius: 14,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      minHeight: 78,
      padding: 6,
    },
    focusTimerLabel: {
      fontSize: 12,
      opacity: 0.85,
      marginBottom: 4,
    },
    focusTimerValue: {
      fontSize: 28,
      fontWeight: "bold",
      letterSpacing: 0.5,
      whiteSpace: "nowrap",
    },
    focusButtons: {
      display: "grid",
      gridTemplateColumns: "2fr 1fr 1fr",
      gap: 8,
      marginBottom: 10,
    },
    focusLapButton: {
      width: "100%",
      border: "none",
      borderRadius: 16,
      padding: "22px 8px",
      fontSize: 28,
      fontWeight: "bold",
      background: "#2563eb",
      color: "#fff",
      cursor: "pointer",
      minHeight: 82,
    },
    focusLapButtonDisabled: {
      width: "100%",
      border: "none",
      borderRadius: 16,
      padding: "22px 8px",
      fontSize: 28,
      fontWeight: "bold",
      background: "#93c5fd",
      color: "#fff",
      cursor: "not-allowed",
      minHeight: 82,
    },
    focusSmallButton: (bg = "#e5e7eb", color = "#111", disabled = false) => ({
      width: "100%",
      border: "none",
      borderRadius: 14,
      padding: "14px 8px",
      fontSize: 18,
      fontWeight: "bold",
      background: disabled ? "#d1d5db" : bg,
      color,
      cursor: disabled ? "not-allowed" : "pointer",
      minHeight: 82,
    }),
    focusBottomInfo: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 8,
      fontSize: 14,
      color: "#555",
      textAlign: "center",
    },
  };

  return (
    <div style={styles.app}>
      <div style={styles.title}>陸上部マネージャー用 ラップ記録アプリ</div>
      <div style={styles.subtitle}>
        練習用・試合用・試合特化用の3モード対応。読み上げは「1秒37」「1分1秒37」の形で読んで、試合特化用でもCSVと履歴を使えます。
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
                  <option value="race_focus">試合特化用</option>
                </select>
              </div>

              <div>
                <label style={styles.label}>読み上げ</label>
                <button
                  style={styles.button(speechEnabled ? "#16a34a" : "#64748b", "#fff")}
                  onClick={() => setSpeechEnabled((prev) => !prev)}
                >
                  {speechEnabled ? "オン" : "オフ"}
                </button>
              </div>

              <div>
                <label style={styles.label}>入力欄</label>
                <button
                  style={styles.button("#334155", "#fff")}
                  onClick={() => setShowSettings((prev) => !prev)}
                >
                  {showSettings ? "隠す" : "表示"}
                </button>
              </div>

              {mode === "practice" ? (
                <div>
                  <label style={styles.label}>操作</label>
                  <button style={styles.button("#64748b", "#fff", true)} disabled>
                    個別スタート
                  </button>
                </div>
              ) : (
                <div>
                  <label style={styles.label}>一斉操作</label>
                  <button
                    style={styles.button("#16a34a", "#fff", raceRunning)}
                    onClick={startRace}
                    disabled={raceRunning}
                  >
                    全員同時スタート
                  </button>
                </div>
              )}

              <div>
                <label style={styles.label}>全体操作</label>
                <button
                  style={styles.button(
                    mode === "practice" ? "#dc2626" : "#f59e0b",
                    "#fff",
                    mode === "practice" ? false : !raceRunning
                  )}
                  onClick={mode === "practice" ? resetAll : stopAllRace}
                  disabled={mode === "practice" ? false : !raceRunning}
                >
                  {mode === "practice" ? "全員リセット" : "全員停止"}
                </button>
              </div>

              <div>
                <label style={styles.label}>保存</label>
                <button style={styles.button("#111827", "#fff")} onClick={saveRecord}>
                  記録を保存
                </button>
              </div>

              <div>
                <label style={styles.label}>出力</label>
                <button style={styles.button("#2563eb", "#fff")} onClick={exportCurrentCsv}>
                  CSV出力
                </button>
              </div>
            </div>
          </div>

          <div style={styles.laneGrid}>
            {visibleRunners.map((runner) => (
              <div key={runner.id} style={styles.laneCard}>
                {mode === "race_focus" ? renderRaceFocusCard(runner) : renderNormalCard(runner)}
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
                  {record.mode === "practice"
                    ? "練習用"
                    : record.mode === "race"
                      ? "試合用"
                      : "試合特化用"}{" "}
                  / 日時: {record.sessionDate}
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
                      <span style={styles.badge}>{`L${runner.lane}${runner.name ? ` ${runner.name}` : ""}`}</span>
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
