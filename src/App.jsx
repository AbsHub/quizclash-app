import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Triangle,
  Diamond,
  Circle,
  Square,
  Users,
  Play,
  Plus,
  Trash2,
  Trophy,
  Zap,
  ArrowRight,
  Clock,
  Image as ImageIcon,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { db } from "./firebase";
import {
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  collection,
  query,
  orderBy,
  limit,
} from "firebase/firestore";

/* ---------------------------------------------------------
   QuizClash — live quiz game
   Host screen (big display) + Player screen (phones)
   Real-time sync via Firestore: one doc per game (host-owned)
   + one doc per player (each player writes only their own doc,
   so simultaneous answers never collide).
--------------------------------------------------------- */

const SHAPES = [
  { Icon: Triangle, color: "#E4572E", label: "Triangle" },
  { Icon: Diamond, color: "#F3A712", label: "Diamond" },
  { Icon: Circle, color: "#2E86AB", label: "Circle" },
  { Icon: Square, color: "#4C9A6A", label: "Square" },
];

const DEFAULT_DURATION = 20; // seconds
const TIMER_PRESETS = [5, 10, 20, 30, 60, 90];
const STALE_LOCK_MS = 30 * 60 * 1000; // treat an abandoned game as unlocked after 30 minutes

const SAMPLE_QUIZ = [
  { text: "Which planet is known as the Red Planet?", choices: ["Venus", "Mars", "Jupiter", "Saturn"], correct: 1, duration: 20, image: "" },
  { text: "What is the capital of Japan?", choices: ["Seoul", "Beijing", "Tokyo", "Bangkok"], correct: 2, duration: 20, image: "" },
  { text: "How many legs does a spider have?", choices: ["6", "8", "10", "12"], correct: 1, duration: 15, image: "" },
  { text: "Which ocean is the largest?", choices: ["Atlantic", "Indian", "Arctic", "Pacific"], correct: 3, duration: 20, image: "" },
  { text: "Who painted the Mona Lisa?", choices: ["Van Gogh", "Da Vinci", "Picasso", "Monet"], correct: 1, duration: 20, image: "" },
];

function genCode() {
  return String(Math.floor(10000 + Math.random() * 90000));
}
function genId() {
  return Math.random().toString(36).slice(2, 10);
}
function scoreFor(correct, elapsedMs, durationMs) {
  if (!correct) return 0;
  const frac = Math.max(0, 1 - elapsedMs / durationMs);
  return Math.round(500 + 500 * frac);
}
function qDurationMs(q) {
  return (q?.duration || DEFAULT_DURATION) * 1000;
}

/* ---- Firestore refs ---- */
const gameRef = (code) => doc(db, "games", code);
const playersColRef = (code) => collection(db, "games", code, "players");
const playerRef = (code, id) => doc(db, "games", code, "players", id);

async function setGame(code, data, merge = true) {
  await setDoc(gameRef(code), data, { merge });
}
async function setPlayer(code, id, data, merge = true) {
  await setDoc(playerRef(code, id), data, { merge });
}

/* ---------------------------- Shell ---------------------------- */

export default function QuizClash() {
  const initialJoinCode = React.useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("join") || "";
  }, []);
  const [role, setRole] = useState(initialJoinCode ? "player" : null); // 'host' | 'player'

  return (
    <div className="min-h-screen w-full bg-[#12172B] text-[#F5F3EE] font-sans overflow-hidden">
      {!role && <Home onPick={setRole} />}
      {role === "host" && <HostApp onExit={() => setRole(null)} />}
      {role === "player" && <PlayerApp onExit={() => setRole(null)} initialCode={initialJoinCode} />}
    </div>
  );
}

function Home({ onPick }) {
  const [activeGame, setActiveGame] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "games"), orderBy("createdAt", "desc"), limit(1));
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) {
        setActiveGame(null);
        return;
      }
      const d = snap.docs[0];
      const data = d.data();
      const isStale = Date.now() - (data.createdAt || 0) > STALE_LOCK_MS;
      const isLive = data.phase !== "final" && !isStale;
      setActiveGame(isLive ? { code: d.id, ...data } : null);
    });
    return unsub;
  }, []);

  const hostDisabled = !!activeGame;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 rise-in">
      <div className="flex items-center gap-2 mb-2 text-[#F3A712]">
        <Zap size={28} strokeWidth={2.5} />
        <span className="font-display font-700 text-3xl tracking-tight">QuizClash</span>
      </div>
      <p className="text-[#9CA3C4] mb-10 text-center max-w-sm">
        Live quiz games. One big screen, everyone else on their phone.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={() => !hostDisabled && onPick("host")}
          disabled={hostDisabled}
          className="group flex items-center justify-between gap-3 bg-[#F3A712] text-[#12172B] font-display font-700 text-lg px-6 py-4 rounded-2xl hover:brightness-105 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
        >
          Host a game
          <Play size={20} fill="#12172B" />
        </button>
        {hostDisabled && (
          <p className="text-xs text-[#9CA3C4] text-center -mt-1 px-2">
            A game is already in progress (PIN {activeGame.code}). Join it below, or wait for it to finish.
          </p>
        )}
        <button
          onClick={() => onPick("player")}
          className="flex items-center justify-between gap-3 bg-transparent border-2 border-[#3A4066] text-[#F5F3EE] font-display font-700 text-lg px-6 py-4 rounded-2xl hover:border-[#F5F3EE] active:scale-[0.98] transition mt-1"
        >
          Join a game
          <ArrowRight size={20} />
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   HOST
   ============================================================ */

function HostApp({ onExit }) {
  const [stage, setStage] = useState("setup");
  const [code] = useState(genCode);
  const [questions, setQuestions] = useState(SAMPLE_QUIZ);
  const [state, setState] = useState(null);
  const [players, setPlayers] = useState([]);

  useEffect(() => {
    if (stage === "setup") return;
    const unsub = onSnapshot(playersColRef(code), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => b.score - a.score);
      setPlayers(list);
    });
    return unsub;
  }, [stage, code]);

  async function createGame() {
    const initial = {
      code,
      phase: "lobby",
      questions,
      currentIndex: -1,
      questionStartTime: null,
      createdAt: Date.now(),
    };
    await setGame(code, initial, false);
    setState(initial);
    setStage("lobby");
  }

  async function startGame() {
    const next = { ...state, phase: "question", currentIndex: 0, questionStartTime: Date.now() };
    await setGame(code, next);
    setState(next);
    setStage("question");
  }

  async function revealQuestion() {
    const next = { ...state, phase: "reveal" };
    await setGame(code, next);
    setState(next);
    setStage("reveal");
  }

  async function nextQuestion() {
    const ni = state.currentIndex + 1;
    if (ni >= questions.length) {
      const next = { ...state, phase: "final" };
      await setGame(code, next);
      setState(next);
      setStage("final");
      return;
    }
    const next = { ...state, phase: "question", currentIndex: ni, questionStartTime: Date.now() };
    await setGame(code, next);
    setState(next);
    setStage("question");
  }

  async function cancelGame() {
    if (!window.confirm("Cancel this game? Players will no longer be able to join or continue, and this releases the Home screen lock.")) {
      return;
    }
    if (state) {
      await setGame(code, { ...state, phase: "final" });
    }
    onExit();
  }

  if (stage === "setup") {
    return <HostSetup questions={questions} setQuestions={setQuestions} onCreate={createGame} onExit={onExit} />;
  }
  if (stage === "lobby") {
    return <HostLobby code={code} players={players} onStart={startGame} count={players.length} onCancel={cancelGame} />;
  }
  if (stage === "question") {
    return (
      <HostQuestion
        q={questions[state.currentIndex]}
        index={state.currentIndex}
        total={questions.length}
        startTime={state.questionStartTime}
        duration={qDurationMs(questions[state.currentIndex])}
        answeredCount={players.filter((p) => p.answers && p.answers[state.currentIndex]).length}
        totalPlayers={players.length}
        onTimeUp={revealQuestion}
        onCancel={cancelGame}
      />
    );
  }
  if (stage === "reveal") {
    return (
      <HostReveal
        q={questions[state.currentIndex]}
        index={state.currentIndex}
        total={questions.length}
        players={players}
        onNext={nextQuestion}
        onCancel={cancelGame}
      />
    );
  }
  if (stage === "final") {
    return <FinalLeaderboard players={players} onExit={onExit} isHost />;
  }
  return null;
}

function TimerChips({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TIMER_PRESETS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className="px-2.5 py-1 rounded-full text-xs font-medium transition"
          style={{
            backgroundColor: value === s ? "#F3A712" : "#12172B",
            color: value === s ? "#12172B" : "#9CA3C4",
            border: `1px solid ${value === s ? "#F3A712" : "#2A3058"}`,
          }}
        >
          {s}s
        </button>
      ))}
      <input
        type="number"
        min={3}
        max={300}
        value={value}
        onChange={(e) => onChange(Math.max(3, Math.min(300, Number(e.target.value) || DEFAULT_DURATION)))}
        className="w-16 bg-[#12172B] rounded-full px-2 py-1 text-xs text-center outline-none border border-[#2A3058] focus:border-[#F3A712]"
      />
    </div>
  );
}

function HostSetup({ questions, setQuestions, onCreate, onExit }) {
  const [editing, setEditing] = useState(false);
  const [defaultDuration, setDefaultDuration] = useState(DEFAULT_DURATION);

  function updateQ(i, patch) {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }
  function updateChoice(i, ci, val) {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, choices: q.choices.map((c, cidx) => (cidx === ci ? val : c)) } : q)));
  }
  function addQuestion() {
    setQuestions((qs) => [...qs, { text: "", choices: ["", "", "", ""], correct: 0, duration: defaultDuration, image: "" }]);
  }
  function removeQuestion(i) {
    setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  }
  function applyTimerToAll() {
    setQuestions((qs) => qs.map((q) => ({ ...q, duration: defaultDuration })));
  }

  return (
    <div className="min-h-screen px-5 py-8 max-w-2xl mx-auto rise-in">
      <button onClick={onExit} className="text-[#9CA3C4] text-sm mb-4">← Back</button>
      <h1 className="font-display font-700 text-2xl mb-1">Set up your quiz</h1>
      <p className="text-[#9CA3C4] mb-6 text-sm">
        {editing ? "Edit the questions below, or keep the sample set." : `${questions.length} questions ready to go.`}
      </p>

      <div className="bg-[#1B2140] rounded-2xl p-4 mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-[#D8DCF2]">
          <Clock size={16} className="text-[#F3A712]" /> Default timer
        </div>
        <div className="flex items-center gap-2">
          <TimerChips value={defaultDuration} onChange={setDefaultDuration} />
          <button onClick={applyTimerToAll} className="text-xs text-[#F3A712] font-medium whitespace-nowrap">
            Apply to all
          </button>
        </div>
      </div>

      {!editing && (
        <div className="flex flex-col gap-3 mb-8">
          {questions.map((q, i) => (
            <div key={i} className="bg-[#1B2140] rounded-xl px-4 py-3 text-sm text-[#D8DCF2] flex items-center gap-3">
              {q.image ? (
                <img src={q.image} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-[#12172B]" />
              ) : (
                <span className="text-[#F3A712] font-display flex-shrink-0">{i + 1}.</span>
              )}
              <span className="flex-1">{q.text || <span className="text-[#6B7299] italic">Empty question</span>}</span>
              <span className="flex items-center gap-1 text-xs text-[#6B7299] flex-shrink-0">
                <Clock size={12} /> {q.duration || defaultDuration}s
              </span>
            </div>
          ))}
          <button onClick={() => setEditing(true)} className="text-[#F3A712] text-sm font-medium text-left mt-1">
            Edit questions →
          </button>
        </div>
      )}

      {editing && (
        <div className="flex flex-col gap-5 mb-8">
          {questions.map((q, i) => (
            <div key={i} className="bg-[#1B2140] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-display text-[#F3A712] text-sm">Question {i + 1}</span>
                <button onClick={() => removeQuestion(i)} className="text-[#6B7299] hover:text-[#E4572E]">
                  <Trash2 size={16} />
                </button>
              </div>
              <input
                value={q.text}
                onChange={(e) => updateQ(i, { text: e.target.value })}
                placeholder="Question text"
                className="w-full bg-[#12172B] rounded-lg px-3 py-2 mb-3 text-sm outline-none border border-[#2A3058] focus:border-[#F3A712]"
              />
              <div className="flex items-center gap-2 mb-3">
                <ImageIcon size={14} className="text-[#6B7299] flex-shrink-0" />
                <input
                  value={q.image || ""}
                  onChange={(e) => updateQ(i, { image: e.target.value })}
                  placeholder="Image URL (optional)"
                  className="flex-1 bg-[#12172B] rounded-lg px-2 py-1.5 text-xs outline-none border border-[#2A3058] focus:border-[#F3A712]"
                />
                {q.image && (
                  <img
                    src={q.image}
                    alt="preview"
                    className="w-8 h-8 rounded-md object-cover bg-[#12172B] flex-shrink-0"
                    onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {q.choices.map((c, ci) => {
                  const { Icon, color } = SHAPES[ci];
                  return (
                    <div key={ci} className="flex items-center gap-2">
                      <Icon size={16} color={color} fill={color} />
                      <input
                        value={c}
                        onChange={(e) => updateChoice(i, ci, e.target.value)}
                        placeholder={`Choice ${ci + 1}`}
                        className="flex-1 bg-[#12172B] rounded-lg px-2 py-1.5 text-xs outline-none border border-[#2A3058] focus:border-[#F3A712]"
                      />
                      <input type="radio" name={`correct-${i}`} checked={q.correct === ci} onChange={() => updateQ(i, { correct: ci })} title="Correct answer" />
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-[#2A3058]">
                <Clock size={14} className="text-[#6B7299] flex-shrink-0" />
                <TimerChips value={q.duration || defaultDuration} onChange={(v) => updateQ(i, { duration: v })} />
              </div>
            </div>
          ))}
          <button
            onClick={addQuestion}
            className="flex items-center justify-center gap-2 border-2 border-dashed border-[#2A3058] rounded-xl py-3 text-[#9CA3C4] text-sm hover:border-[#F3A712] hover:text-[#F3A712] transition"
          >
            <Plus size={16} /> Add question
          </button>
          <button onClick={() => setEditing(false)} className="text-[#9CA3C4] text-sm">
            Done editing
          </button>
        </div>
      )}

      <button
        onClick={onCreate}
        disabled={questions.length === 0 || questions.some((q) => !q.text || q.choices.some((c) => !c))}
        className="w-full bg-[#F3A712] text-[#12172B] font-display font-700 text-lg py-4 rounded-2xl disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-105 active:scale-[0.99] transition"
      >
        Create game
      </button>
    </div>
  );
}

function JoinQRCode({ code }) {
  const [dataUrl, setDataUrl] = useState(null);

  useEffect(() => {
    const joinUrl = `${window.location.origin}${window.location.pathname}?join=${code}`;
    QRCode.toDataURL(joinUrl, {
      width: 220,
      margin: 1,
      color: { dark: "#12172B", light: "#FFFFFF" },
    })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [code]);

  if (!dataUrl) return null;
  return (
    <div className="bg-white rounded-2xl p-3 mb-6 pop-in">
      <img src={dataUrl} alt="Scan to join" width={160} height={160} className="block" />
    </div>
  );
}

function HostLobby({ code, players, onStart, count, onCancel }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 rise-in">
      <p className="text-[#9CA3C4] mb-2 text-sm tracking-wide uppercase">Game PIN</p>
      <div className="font-display font-700 text-6xl sm:text-7xl tracking-widest mb-6 text-[#F5F3EE]">{code}</div>

      <JoinQRCode code={code} />

      <p className="text-[#9CA3C4] mb-6 text-sm text-center max-w-xs">
        Scan the code, or open the site and enter the PIN above.
      </p>

      <div className="w-full max-w-md bg-[#1B2140] rounded-2xl p-5 mb-8 min-h-[100px]">
        <div className="flex items-center gap-2 text-[#9CA3C4] text-sm mb-3">
          <Users size={16} /> {count} joined
        </div>
        <div className="flex flex-wrap gap-2">
          {players.map((p) => (
            <span key={p.id} className="pop-in bg-[#2A3058] rounded-full px-3 py-1.5 text-sm text-[#F5F3EE]">
              {p.name}
            </span>
          ))}
          {count === 0 && <span className="text-[#6B7299] text-sm italic">Waiting for players…</span>}
        </div>
      </div>

      <button
        onClick={onStart}
        disabled={count === 0}
        className="flex items-center gap-2 bg-[#F3A712] text-[#12172B] font-display font-700 text-lg px-8 py-4 rounded-2xl disabled:opacity-30 hover:brightness-105 active:scale-[0.98] transition mb-4"
      >
        <Play size={20} fill="#12172B" /> Start game
      </button>

      <button onClick={onCancel} className="text-[#9CA3C4] text-sm hover:text-[#E4572E] transition">
        Cancel game
      </button>
    </div>
  );
}

function useCountdown(startTime, duration, onDone) {
  const [remaining, setRemaining] = useState(duration);
  useEffect(() => {
    if (!startTime) return;
    const tick = () => {
      const left = Math.max(0, duration - (Date.now() - startTime));
      setRemaining(left);
      if (left <= 0) onDone && onDone();
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [startTime, duration]);
  return remaining;
}

function CountdownRing({ fraction, size = 64 }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#2A3058" strokeWidth="4" fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="#F3A712"
        strokeWidth="4"
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - fraction)}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.2s linear" }}
      />
    </svg>
  );
}

function HostQuestion({ q, index, total, startTime, duration, answeredCount, totalPlayers, onTimeUp, onCancel }) {
  const remaining = useCountdown(startTime, duration, onTimeUp);
  const fraction = remaining / duration;
  const secs = Math.ceil(remaining / 1000);

  return (
    <div className="min-h-screen flex flex-col px-6 py-8 rise-in">
      <div className="flex items-center justify-between mb-6">
        <span className="text-[#9CA3C4] text-sm font-medium">Question {index + 1} / {total}</span>
        <div className="flex items-center gap-4">
          <div className="relative flex items-center justify-center">
            <CountdownRing fraction={fraction} />
            <span className="absolute font-display font-700 text-sm">{secs}</span>
          </div>
          <button onClick={onCancel} title="End game" className="text-[#6B7299] hover:text-[#E4572E] transition">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-4">
        <h2 className="font-display font-700 text-3xl sm:text-4xl leading-tight max-w-2xl">{q.text}</h2>
        {q.image && (
          <img src={q.image} alt="" className="max-h-56 sm:max-h-64 rounded-2xl object-contain border border-[#2A3058] bg-[#1B2140]" />
        )}
      </div>

      <div className="flex items-center justify-center gap-2 text-[#9CA3C4] text-sm mb-6">
        <Users size={14} /> {answeredCount} / {totalPlayers} answered
      </div>

      <div className="grid grid-cols-2 gap-3 max-w-2xl w-full mx-auto">
        {q.choices.map((c, i) => {
          const { Icon, color } = SHAPES[i];
          return (
            <div key={i} className="flex items-center gap-3 rounded-2xl px-5 py-4" style={{ backgroundColor: color }}>
              <Icon size={22} color="#12172B" fill="#12172B" />
              <span className="font-display font-600 text-[#12172B] text-base">{c}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HostReveal({ q, index, total, players, onNext, onCancel }) {
  const counts = SHAPES.map((_, i) => players.filter((p) => p.answers?.[index]?.choice === i).length);
  const maxCount = Math.max(1, ...counts);
  const podium = players.slice(0, 5);

  return (
    <div className="min-h-screen flex flex-col px-6 py-8 rise-in">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[#9CA3C4] text-sm font-medium">Question {index + 1} / {total} · Results</span>
        <button onClick={onCancel} title="End game" className="text-[#6B7299] hover:text-[#E4572E] transition">
          <X size={20} />
        </button>
      </div>
      <div className="flex items-center gap-3 mb-6">
        {q.image && <img src={q.image} alt="" className="w-14 h-14 rounded-xl object-cover border border-[#2A3058] flex-shrink-0" />}
        <h2 className="font-display font-700 text-2xl">{q.text}</h2>
      </div>

      <div className="flex flex-col gap-3 max-w-2xl w-full mx-auto mb-8">
        {q.choices.map((c, i) => {
          const { Icon, color } = SHAPES[i];
          const isCorrect = q.correct === i;
          return (
            <div key={i} className="flex items-center gap-3">
              <Icon size={20} color={color} fill={color} />
              <div className="flex-1 bg-[#1B2140] rounded-lg h-9 relative overflow-hidden">
                <div className="h-full rounded-lg" style={{ width: `${(counts[i] / maxCount) * 100}%`, backgroundColor: color, opacity: isCorrect ? 1 : 0.45 }} />
                <span className="absolute inset-0 flex items-center px-3 text-sm font-medium text-[#F5F3EE]">
                  {c} {isCorrect && "✓"}
                </span>
              </div>
              <span className="text-sm text-[#9CA3C4] w-6 text-right">{counts[i]}</span>
            </div>
          );
        })}
      </div>

      <div className="max-w-md w-full mx-auto bg-[#1B2140] rounded-2xl p-5 mb-8 flex-1">
        <div className="flex items-center gap-2 text-[#F3A712] text-sm font-medium mb-3">
          <Trophy size={16} /> Leaderboard
        </div>
        <div className="flex flex-col gap-2">
          {podium.map((p, i) => (
            <div key={p.id} className="flex items-center justify-between text-sm">
              <span className="text-[#F5F3EE]">{i + 1}. {p.name}</span>
              <span className="text-[#9CA3C4] font-display">{p.score}</span>
            </div>
          ))}
          {podium.length === 0 && <span className="text-[#6B7299] text-sm italic">No answers yet</span>}
        </div>
      </div>

      <button
        onClick={onNext}
        className="max-w-md w-full mx-auto flex items-center justify-center gap-2 bg-[#F3A712] text-[#12172B] font-display font-700 text-lg py-4 rounded-2xl hover:brightness-105 active:scale-[0.98] transition"
      >
        {index + 1 >= total ? "See final results" : "Next question"} <ArrowRight size={20} />
      </button>
    </div>
  );
}

function FinalLeaderboard({ players, onExit, isHost }) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  const medalColor = ["#F3A712", "#9CA3C4", "#B08050"];
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 rise-in">
      <Trophy size={40} color="#F3A712" className="mb-3" />
      <h1 className="font-display font-700 text-3xl mb-8">Final results</h1>
      <div className="w-full max-w-md flex flex-col gap-2 mb-10">
        {ranked.map((p, i) => (
          <div
            key={p.id}
            className="pop-in flex items-center justify-between rounded-xl px-4 py-3"
            style={{ backgroundColor: i < 3 ? "#1B2140" : "#161B36", borderLeft: i < 3 ? `4px solid ${medalColor[i]}` : "4px solid transparent" }}
          >
            <span className="font-medium">{i + 1}. {p.name}</span>
            <span className="font-display text-[#F3A712]">{p.score}</span>
          </div>
        ))}
        {ranked.length === 0 && <span className="text-[#6B7299] text-sm italic text-center">No players</span>}
      </div>
      <button onClick={onExit} className="text-[#9CA3C4] text-sm underline">
        {isHost ? "New game" : "Back to home"}
      </button>
    </div>
  );
}

/* ============================================================
   PLAYER
   ============================================================ */

function PlayerApp({ onExit, initialCode = "" }) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [id] = useState(genId);
  const [error, setError] = useState("");
  const [state, setState] = useState(null);
  const [me, setMe] = useState(null);
  const meRef = useRef(null);
  meRef.current = me;

  useEffect(() => {
    if (!joined) return;
    const unsub = onSnapshot(gameRef(code), (snap) => {
      if (snap.exists()) setState(snap.data());
    });
    return unsub;
  }, [joined, code]);

  async function handleJoin() {
    setError("");
    const trimmedCode = code.trim();
    if (!trimmedCode || !name.trim()) {
      setError("Enter a PIN and a nickname.");
      return;
    }
    const snap = await getDoc(gameRef(trimmedCode));
    if (!snap.exists()) {
      setError("No game found with that PIN.");
      return;
    }
    const player = { id, name: name.trim(), score: 0, answers: {} };
    await setPlayer(trimmedCode, id, player, false);
    setMe(player);
    setState(snap.data());
    setCode(trimmedCode);
    setJoined(true);
  }

  async function submitAnswer(choiceIndex) {
    if (!state || !meRef.current) return;
    const qi = state.currentIndex;
    if (meRef.current.answers[qi]) return;
    const q = state.questions[qi];
    const elapsed = Date.now() - state.questionStartTime;
    const correct = choiceIndex === q.correct;
    const points = scoreFor(correct, elapsed, qDurationMs(q));
    const updated = {
      ...meRef.current,
      score: meRef.current.score + points,
      answers: { ...meRef.current.answers, [qi]: { choice: choiceIndex, correct, points } },
    };
    setMe(updated);
    await setPlayer(code, id, updated);
  }

  if (!joined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 rise-in relative">
        <button onClick={onExit} className="absolute top-6 left-6 text-[#9CA3C4] text-sm">← Back</button>
        <div className="flex items-center gap-2 mb-8 text-[#F3A712]">
          <Zap size={24} strokeWidth={2.5} />
          <span className="font-display font-700 text-2xl">QuizClash</span>
        </div>
        <div className="w-full max-w-xs flex flex-col gap-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="Game PIN"
            inputMode="numeric"
            className="bg-[#1B2140] rounded-xl px-4 py-4 text-center font-display text-2xl tracking-widest outline-none border-2 border-[#2A3058] focus:border-[#F3A712]"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nickname"
            maxLength={18}
            autoFocus={!!initialCode}
            className="bg-[#1B2140] rounded-xl px-4 py-3 text-center outline-none border-2 border-[#2A3058] focus:border-[#F3A712]"
          />
          {error && <p className="text-[#E4572E] text-sm text-center">{error}</p>}
          <button
            onClick={handleJoin}
            className="bg-[#F3A712] text-[#12172B] font-display font-700 text-lg py-4 rounded-2xl hover:brightness-105 active:scale-[0.98] transition"
          >
            Join
          </button>
        </div>
      </div>
    );
  }

  if (!state || state.phase === "lobby") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 rise-in">
        <div className="w-16 h-16 rounded-full bg-[#1B2140] flex items-center justify-center mb-4 pop-in">
          <Users size={26} color="#F3A712" />
        </div>
        <p className="font-display font-700 text-xl mb-1">You're in, {me?.name}!</p>
        <p className="text-[#9CA3C4] text-sm">Waiting for the host to start…</p>
      </div>
    );
  }

  if (state.phase === "final") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 rise-in">
        <Trophy size={36} color="#F3A712" className="mb-3" />
        <p className="font-display font-700 text-2xl mb-1">Game over!</p>
        <p className="text-[#9CA3C4] mb-6">Your score: <span className="text-[#F5F3EE] font-display">{me?.score ?? 0}</span></p>
        <button onClick={onExit} className="text-[#9CA3C4] text-sm underline">Back to home</button>
      </div>
    );
  }

  const qi = state.currentIndex;
  const q = state.questions[qi];
  const myAnswer = me?.answers?.[qi];

  if (state.phase === "question") {
    if (myAnswer) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center px-6 rise-in">
          <div className="pop-in text-center">
            <p className="font-display font-700 text-xl mb-2">Answer locked in</p>
            <p className="text-[#9CA3C4] text-sm">Waiting for other players…</p>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex flex-col px-5 py-8">
        <div className="flex items-center justify-center gap-2 text-[#9CA3C4] text-sm mb-8">
          <Clock size={14} /> Answer as fast as you can
        </div>
        <div className="flex-1 grid grid-cols-2 gap-3 content-center max-w-md w-full mx-auto">
          {SHAPES.map((s, i) => (
            <button
              key={i}
              onClick={() => submitAnswer(i)}
              className="active:scale-95 transition rounded-2xl flex flex-col items-center justify-center gap-2 aspect-square"
              style={{ backgroundColor: s.color }}
            >
              <s.Icon size={36} color="#12172B" fill="#12172B" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  const correct = myAnswer?.correct;
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 rise-in">
      {myAnswer ? (
        <>
          <div className="pop-in w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: correct ? "#4C9A6A" : "#E4572E" }}>
            <span className="font-display font-700 text-2xl">{correct ? "✓" : "✕"}</span>
          </div>
          <p className="font-display font-700 text-xl mb-1">{correct ? `+${myAnswer.points} points` : "No points"}</p>
          <p className="text-[#9CA3C4] text-sm">Total score: {me?.score ?? 0}</p>
        </>
      ) : (
        <p className="text-[#9CA3C4]">Time's up — you didn't answer in time.</p>
      )}
    </div>
  );
}
