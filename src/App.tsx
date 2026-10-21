import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowDown, ArrowRight, ArrowUp, Check, CheckCheck, CircleHelp,
  Clock3, GripVertical, LoaderCircle, MessageSquareText, Pause, Play,
  Plus, RefreshCw, Search, Settings2, Share2, TimerReset, Users, Wifi,
  X, Zap
} from "lucide-react";

type Status = "to_discuss" | "discussing" | "discussed";
type Topic = {
  id: string; title: string; description: string | null; author: string | null;
  status: Status; votes: number; sort_order: number; created_at: string;
};
type Vote = { topic_id: string; voter_id: string };
type TimerState = { board: string; duration_seconds: number; remaining_seconds: number | null; ends_at: string | null; updated_at: string };
const STATUSES: { id: Status; title: string; subtitle: string; tint: string }[] = [
  { id: "to_discuss", title: "To discuss", subtitle: "Ideas & open questions", tint: "stone" },
  { id: "discussing", title: "Discussing", subtitle: "Focus on the conversation", tint: "violet" },
  { id: "discussed", title: "Discussed", subtitle: "Covered & concluded", tint: "emerald" }
];

const params = new URLSearchParams(window.location.search);
const boardId = (params.get("board") || "team-meeting").trim().slice(0, 40) || "team-meeting";
const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const configured = Boolean(envUrl && envKey && !envUrl.includes("YOUR_PROJECT") && !envKey.includes("YOUR_SUPABASE"));
const supabase: SupabaseClient | null = configured ? createClient(envUrl!, envKey!) : null;
function getVoterId() {
  const key = "discussion-board-voter-v1";
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}
function formatTime(ms: number) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function App() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sortByVotes, setSortByVotes] = useState(true);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftAuthor, setDraftAuthor] = useState(localStorage.getItem("discussion-board-name") || "");
  const [draftStatus, setDraftStatus] = useState<Status>("to_discuss");
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(300000);
  const [duration, setDuration] = useState(300);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const voterId = useMemo(getVoterId, []);
  const myVotes = useMemo(() => new Set(votes.filter(v => v.voter_id === voterId).map(v => v.topic_id)), [votes, voterId]);
  const filtered = useMemo(() => topics.filter(t => `${t.title} ${t.description || ""} ${t.author || ""}`.toLowerCase().includes(query.toLowerCase())), [topics, query]);
  const counts = useMemo(() => ({
    total: topics.length,
    to_discuss: topics.filter(t => t.status === "to_discuss").length,
    discussing: topics.filter(t => t.status === "discussing").length,
    discussed: topics.filter(t => t.status === "discussed").length,
    votes: topics.reduce((sum, topic) => sum + topic.votes, 0)
  }), [topics]);
  const chosenTopic = topics.find(t => t.id === selectedTopic) || topics.find(t => t.status === "discussing") || null;
  const timerRunning = Boolean(timer?.ends_at && secondsLeft > 0);

  const announce = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(current => current === message ? "" : current), 3000);
  }, []);

  const loadData = useCallback(async (showLoading = false) => {
    if (!supabase) { setLoading(false); setConnected(false); return; }
    if (showLoading) setLoading(true);
    const [topicRes, voteRes, timerRes] = await Promise.all([
      supabase.from("topics").select("*").order("sort_order", { ascending: true }),
      supabase.from("topic_votes").select("topic_id,voter_id"),
      supabase.from("timers").select("*").eq("board", boardId).maybeSingle()
    ]);
    const failure = topicRes.error || voteRes.error || timerRes.error;
    if (failure) setError(failure.message);
    else {
      setError("");
      setTopics((topicRes.data || []) as Topic[]);
      setVotes((voteRes.data || []) as Vote[]);
      if (timerRes.data) {
        const t = timerRes.data as TimerState;
        setTimer(t);
        setDuration(t.duration_seconds);
        setSecondsLeft(t.ends_at ? Math.max(0, new Date(t.ends_at).getTime() - Date.now()) : Math.max(0, (t.remaining_seconds ?? t.duration_seconds) * 1000));
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let alive = true;
    void loadData(true);
    const channel = supabase.channel(`board-${boardId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "topics" }, () => { if (alive) void loadData(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "topic_votes" }, () => { if (alive) void loadData(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "timers" }, () => { if (alive) void loadData(); })
      .subscribe(status => { if (alive) setConnected(status === "SUBSCRIBED"); });
    const poll = window.setInterval(() => { if (alive) void loadData(); }, 20000);
    return () => { alive = false; window.clearInterval(poll); void supabase.removeChannel(channel); };
  }, [loadData]);

  useEffect(() => {
    if (!timer) return;
    const interval = window.setInterval(() => {
      setSecondsLeft(timer.ends_at ? Math.max(0, new Date(timer.ends_at).getTime() - Date.now()) : Math.max(0, (timer.remaining_seconds ?? timer.duration_seconds) * 1000));
    }, 200);
    return () => window.clearInterval(interval);
  }, [timer]);

  async function saveTopic(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return announce("Add your Supabase settings before saving topics.");
    const title = draftTitle.trim();
    if (!title) return;
    setBusyId(editId || "new");
    const payload = { title, description: draftDescription.trim() || null, author: draftAuthor.trim() || "Team", status: draftStatus };
    const result = editId
      ? await supabase.from("topics").update(payload).eq("id", editId).select().single()
      : await supabase.from("topics").insert({ ...payload, sort_order: Date.now() }).select().single();
    setBusyId(null);
    if (result.error) { setError(result.error.message); announce("Could not save topic"); return; }
    if (draftAuthor.trim()) localStorage.setItem("discussion-board-name", draftAuthor.trim());
    setModal(false); setEditId(null); setDraftTitle(""); setDraftDescription("");
    await loadData();
    if (result.data?.id) setSelectedTopic(result.data.id);
    announce(editId ? "Topic updated" : "Topic added");
  }

  async function moveTopic(id: string, status: Status) {
    if (!supabase) return announce("Connect Supabase to sync changes.");
    const topic = topics.find(t => t.id === id);
    if (!topic || topic.status === status) return;
    setTopics(prev => prev.map(t => t.id === id ? { ...t, status } : t));
    const result = await supabase.from("topics").update({ status, sort_order: Date.now() }).eq("id", id);
    if (result.error) { setError(result.error.message); await loadData(); announce("Move failed — board refreshed"); }
  }

  async function toggleVote(topic: Topic) {
    if (!supabase) return announce("Connect Supabase to save votes.");
    setBusyId(topic.id);
    const hasVote = myVotes.has(topic.id);
    const result = hasVote
      ? await supabase.from("topic_votes").delete().eq("topic_id", topic.id).eq("voter_id", voterId)
      : await supabase.from("topic_votes").insert({ topic_id: topic.id, voter_id: voterId });
    setBusyId(null);
    if (result.error) { setError(result.error.message); announce(result.error.code === "23505" ? "You have already voted on this topic" : "Vote could not be saved"); }
    await loadData();
  }

  async function updateTimer(action: "start" | "pause" | "reset" | "add", value = duration) {
    if (!supabase) return announce("Connect Supabase to share the timer.");
    const rpcName = action === "start" ? "timer_start" : action === "pause" ? "timer_pause" : action === "reset" ? "timer_reset" : "timer_add";
    const args: Record<string, unknown> = { p_board: boardId };
    if (action === "start" || action === "reset") args.p_seconds = value;
    if (action === "add") args.p_seconds = value;
    const result = await supabase.rpc(rpcName, args);
    if (result.error) {
      setError(result.error.message);
      announce("Timer update failed. Check Supabase timer functions.");
    } else {
      await loadData();
      if (action === "start") announce("Shared timer started");
      if (action === "pause") announce("Shared timer paused");
      if (action === "reset") announce("Shared timer reset");
      if (action === "add") announce("One minute added");
    }
  }

  function openNew(status: Status = "to_discuss") {
    setEditId(null); setDraftTitle(""); setDraftDescription(""); setDraftStatus(status); setModal(true);
  }
  function openEdit(topic: Topic) {
    setEditId(topic.id); setDraftTitle(topic.title); setDraftDescription(topic.description || "");
    setDraftAuthor(topic.author || ""); setDraftStatus(topic.status); setModal(true);
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      announce("Board link copied");
    } catch {
      window.prompt("Copy this board link", window.location.href);
    }
  }
  const columns = STATUSES.map(status => ({
    ...status,
    topics: filtered.filter(t => t.status === status.id).sort((a,b) => sortByVotes && status.id === "to_discuss" ? b.votes-a.votes : a.sort_order-b.sort_order)
  }));
  const setupMissing = !supabase;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href={window.location.pathname + "?board=" + encodeURIComponent(boardId)} aria-label="Discussion board home">
        <span className="brand-mark"><MessageSquareText size={22}/></span>
        <span><span className="brand-eyebrow">TEAM WORKSPACE</span><strong>Discussion<span className="brand-period">.</span></strong></span>
      </a>
      <div className="header-right">
        <span className={connected ? "connection online" : "connection"}><span className="status-dot"/>{connected ? "Live sync active" : setupMissing ? "Setup required" : "Connecting…"}</span>
        <span className="board-name"><Users size={15}/>{boardId}</span>
        <button className="btn btn-ghost" onClick={() => void copyLink()}><Share2 size={15}/> <span>Share board</span></button>
        <button className="btn btn-dark" onClick={() => openNew()}><Plus size={16}/> Add topic</button>
      </div>
    </header>

    <main>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line"/> MAKE THE MEETING COUNT</div>
          <h1>Good conversations.<br/><span>Great outcomes.</span></h1>
          <p>One shared space to raise ideas, find priorities and leave every meeting with clarity.</p>
        </div>
        <div className="hero-stamp"><Zap size={18}/><span>LESS STATUS.<br/>MORE PROGRESS.</span></div>
      </section>

      {setupMissing && <div className="setup-banner">
        <div className="setup-icon"><Settings2 size={20}/></div>
        <div className="setup-text"><strong>Connect your Supabase project</strong><span>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your local <code>.env</code> or Vercel environment settings to enable shared data and live updates.</span></div>
        <a className="btn btn-light" href="https://supabase.com/dashboard/project/dwhsmqbupqaoxziymfos" target="_blank" rel="noreferrer">Open Supabase <ArrowRight size={15}/></a>
      </div>}
      {error && !setupMissing && <div className="error-banner"><CircleHelp size={18}/><span><strong>Connection issue</strong><br/>{error} Check the schema and Row Level Security policies.</span><button onClick={() => void loadData(true)} className="btn btn-light"><RefreshCw size={14}/> Retry</button></div>}

      <section className="stats">
        <div className="stat-card stat-total"><span className="stat-label">ALL TOPICS</span><div className="stat-bottom"><strong>{counts.total}</strong><span className="stat-icon"><MessageSquareText size={17}/></span></div><span className="stat-caption">On today’s agenda</span></div>
        <div className="stat-card"><span className="stat-label">TO DISCUSS</span><div className="stat-bottom"><strong>{counts.to_discuss}</strong><span className="stat-icon muted-icon"><ArrowDown size={17}/></span></div><span className="stat-caption">Waiting for attention</span></div>
        <div className="stat-card"><span className="stat-label">IN PROGRESS</span><div className="stat-bottom"><strong>{counts.discussing}</strong><span className="stat-icon violet-icon"><MessageSquareText size={17}/></span></div><span className="stat-caption">Happening right now</span></div>
        <div className="stat-card"><span className="stat-label">COMPLETED</span><div className="stat-bottom"><strong>{counts.discussed}</strong><span className="stat-icon green-icon"><CheckCheck size={17}/></span></div><span className="stat-caption">Conversations wrapped</span></div>
      </section>

      <section className="timer-panel">
        <div className="timer-left">
          <div className="timer-heading"><span className="timer-glyph"><Clock3 size={19}/></span><div><div className="section-kicker">KEEP THE MOMENTUM</div><h2>Discussion timer</h2></div></div>
          <div className="timer-current"><span className="live-pulse"/><span>{chosenTopic ? chosenTopic.title : "Ready for the next topic"}</span></div>
          <div className="timer-hint">{timerRunning ? "Everyone’s timer is running together." : secondsLeft === 0 ? "Time is up — restart or reset for the next topic." : "Agree a timebox. Keep the conversation moving."}</div>
        </div>
        <div className="timer-center">
          <div className={"timer-digits " + (secondsLeft < 30000 ? "timer-urgent" : "")}>{formatTime(secondsLeft)}</div>
          <div className="timer-track"><span style={{width: duration > 0 ? `${Math.min(100, secondsLeft / (duration * 1000) * 100)}%` : "0%"}}/></div>
          <span className="timer-sync"><Wifi size={13}/> Shared across this board</span>
        </div>
        <div className="timer-controls">
          <label className="sr-only" htmlFor="duration">Timer length</label>
          <select id="duration" className="duration-select" value={duration} onChange={e => {setDuration(Number(e.target.value)); void updateTimer("reset", Number(e.target.value));}}>
            {[120,300,600,900,1200,1800].map(n => <option key={n} value={n}>{n/60} min</option>)}
          </select>
          <button className="btn btn-dark timer-main" onClick={() => void updateTimer(Boolean(timer?.ends_at) ? "pause" : "start", duration)} disabled={setupMissing}>{timerRunning ? <Pause size={15}/> : <Play size={15}/>} {timerRunning ? "Pause" : "Start"}</button>
          <button className="btn btn-outline timer-reset" onClick={() => void updateTimer("reset", duration)} title="Reset timer" disabled={setupMissing}><TimerReset size={16}/></button>
          <button className="btn btn-outline timer-plus" onClick={() => void updateTimer("add", 60)} title="Add one minute" disabled={setupMissing}>+1m</button>
        </div>
      </section>

      <section className="agenda">
        <div className="agenda-toolbar">
          <div><div className="section-kicker">THE SHARED AGENDA</div><h2>Let’s get into it<span className="heading-period">.</span></h2><p>Vote for what matters. Move the conversation forward.</p></div>
          <div className="agenda-actions">
            <label className="search-box"><Search size={16}/><input placeholder="Find a topic…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search topics"/>{query && <button aria-label="Clear search" onClick={() => setQuery("")}><X size={14}/></button>}</label>
            <button className={"btn btn-outline sort-button " + (sortByVotes ? "sort-active" : "")} onClick={() => setSortByVotes(!sortByVotes)}><ArrowUp size={15}/><span>{sortByVotes ? "Top votes" : "Oldest first"}</span></button>
          </div>
        </div>
        <div className="board-grid">
          {columns.map(column => <section key={column.id} className={"board-column col-" + column.id} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain") || dragId; if(id) void moveTopic(id, column.id); setDragId(null); }}>
            <div className="column-header"><div className="column-symbol">{column.id === "to_discuss" ? <ArrowUp size={16}/> : column.id === "discussing" ? <MessageSquareText size={16}/> : <Check size={17}/>}</div><div className="column-title-wrap"><h3>{column.title}</h3><span>{column.subtitle}</span></div><span className="column-count">{column.topics.length}</span></div>
            <div className="topic-list">
              {loading && column.topics.length === 0 ? <div className="empty-state"><LoaderCircle size={19} className="spin"/><span>Loading topics…</span></div>
              : column.topics.length === 0 ? <div className="empty-state"><span className="empty-illustration">{column.id === "discussed" ? <CheckCheck size={23}/> : <MessageSquareText size={23}/>}</span><strong>{query ? "Nothing found" : column.id === "discussed" ? "A clean slate" : "Room for a good idea"}</strong><span>{query ? "Try another search term." : "Add a topic to get the conversation going."}</span>{column.id === "to_discuss" && !query && <button onClick={() => openNew(column.id)} className="empty-add"><Plus size={14}/> Add first topic</button>}</div>
              : column.topics.map((topic,index) => <article className={"topic-card " + (dragId === topic.id ? "dragging" : "") + (selectedTopic === topic.id ? " selected-card" : "")} key={topic.id} draggable onDragStart={e => {setDragId(topic.id);e.dataTransfer.setData("text/plain",topic.id);e.dataTransfer.effectAllowed="move";}} onDragEnd={() => setDragId(null)} onClick={() => setSelectedTopic(topic.id)}>
                <div className="card-meta"><span className="card-index">{String(index+1).padStart(2,"0")}</span><span className="drag-handle" title="Drag to move"><GripVertical size={15}/></span><button className="card-edit" aria-label={"Edit "+topic.title} title="Edit topic" onClick={e=>{e.stopPropagation();openEdit(topic);}}><Settings2 size={15}/></button></div>
                <h4>{topic.title}</h4>{topic.description && <p className="topic-description">{topic.description}</p>}
                <div className="card-footer"><span className="topic-author"><span className="author-avatar">{(topic.author || "T").trim().slice(0,1).toUpperCase()}</span><span>{topic.author || "Team"}</span></span><button className={"vote-button " + (myVotes.has(topic.id) ? "voted" : "")} disabled={busyId === topic.id || setupMissing} onClick={e=>{e.stopPropagation();void toggleVote(topic);}} aria-pressed={myVotes.has(topic.id)} title={myVotes.has(topic.id) ? "Remove your vote" : "Upvote topic"}><ArrowUp size={15}/><span>{topic.votes}</span></button></div>
                <div className="card-moves">{column.id !== "to_discuss" && <button onClick={e=>{e.stopPropagation();void moveTopic(topic.id,"to_discuss");}} title="Move to To discuss"><ArrowDown size={13}/> Queue</button>}{column.id !== "discussing" && <button onClick={e=>{e.stopPropagation();setSelectedTopic(topic.id);void moveTopic(topic.id,"discussing");}} title="Move to Discussing"><Play size={12}/> Discuss</button>}{column.id !== "discussed" && <button onClick={e=>{e.stopPropagation();void moveTopic(topic.id,"discussed");}} title="Mark discussed"><Check size={13}/> Done</button>}</div>
              </article>)}
            </div>
            <button className="column-add" onClick={() => openNew(column.id)}><Plus size={15}/> Add a topic</button>
          </section>)}
        </div>
        <div className="board-foot"><span><span className={"status-dot " + (connected ? "dot-green" : "")}/>{connected ? "Changes sync live" : setupMissing ? "Waiting for Supabase configuration" : "Reconnecting to live sync"}</span><span>{counts.total} topics <span className="foot-separator">·</span> {counts.votes} votes</span><button onClick={() => void loadData(true)}><RefreshCw size={13}/> Refresh</button></div>
      </section>
    </main>

    <footer className="page-footer"><span>DISCUSSION<span className="brand-period">.</span> Made for teams who make things happen.</span><span>Board: <code>{boardId}</code> <span className="foot-separator">·</span> <a href="https://supabase.com/" target="_blank" rel="noreferrer">Powered by Supabase</a></span></footer>

    {modal && <div className="modal-backdrop" role="presentation" onMouseDown={e => {if(e.target===e.currentTarget)setModal(false);}}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><div className="section-kicker">{editId ? "REFINE THE AGENDA" : "PUT IT ON THE TABLE"}</div><h2 id="modal-title">{editId ? "Edit topic" : "Add a topic"}<span className="heading-period">.</span></h2></div><button className="btn btn-outline icon-only" onClick={() => setModal(false)} aria-label="Close"><X size={18}/></button></div><form onSubmit={saveTopic} className="topic-form"><label>Topic title <span className="required">*</span><input value={draftTitle} onChange={e=>setDraftTitle(e.target.value)} maxLength={200} placeholder="What should we discuss?" required autoFocus/></label><label>Context <span className="optional">OPTIONAL</span><textarea value={draftDescription} onChange={e=>setDraftDescription(e.target.value)} maxLength={800} rows={3} placeholder="Add a little background or the question you want answered…"/></label><div className="form-row"><label>Your name<input value={draftAuthor} onChange={e=>setDraftAuthor(e.target.value)} maxLength={64} placeholder="e.g. Alex"/></label><label>Column<select value={draftStatus} onChange={e=>setDraftStatus(e.target.value as Status)}>{STATUSES.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label></div><div className="modal-actions"><button type="button" className="btn btn-outline" onClick={()=>setModal(false)}>Cancel</button><button type="submit" className="btn btn-dark" disabled={busyId !== null || setupMissing}>{busyId ? <LoaderCircle size={15} className="spin"/> : <Plus size={15}/>} {editId ? "Save changes" : "Add to agenda"}</button></div>{setupMissing && <p className="form-note">Configure Supabase environment variables to save agenda topics.</p>}</form></section></div>}
    {toast && <div className="toast"><CheckCircleIcon/> {toast}</div>}
  </div>;
}
function CheckCircleIcon() { return <span className="toast-mark"><Check size={14}/></span>; }
export default App;
