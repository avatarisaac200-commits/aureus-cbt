import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Shuffle, Check, X, Plus,
  Pencil, Trash2, Layers, RotateCcw, ArrowLeft, BookOpen
} from 'lucide-react';

/* ---------- palette & helpers ---------- */
const PALETTE = ['#2F6F63', '#C1502E', '#6B4E71', '#B8860B'];
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = str.charCodeAt(i) + ((h << 5) - h); h |= 0; }
  return Math.abs(h);
}
function colorForCategory(category) {
  return PALETTE[hashStr(category || 'General') % PALETTE.length];
}
function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function makeId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* ---------- seed deck ---------- */
const SEED = [
  { front: 'What is the capital of Australia?', back: 'Canberra — not Sydney, a common mix-up.', category: 'Geography' },
  { front: 'Which desert is the largest hot desert on Earth?', back: 'The Sahara, spanning most of North Africa.', category: 'Geography' },
  { front: 'What gas do plants absorb for photosynthesis?', back: 'Carbon dioxide (CO₂), released as oxygen.', category: 'Science' },
  { front: "What's often called the powerhouse of the cell?", back: 'The mitochondria.', category: 'Science' },
  { front: 'How many bones are in the adult human body?', back: '206.', category: 'Science' },
  { front: "Spanish for 'library'?", back: 'Biblioteca.', category: 'Language' },
  { front: "What does 'ubiquitous' mean?", back: 'Present or appearing everywhere at once.', category: 'Language' },
  { front: 'Longest river in the world?', back: 'The Nile — though the Amazon is a close, disputed rival.', category: 'Geography' },
].map((c) => ({ id: makeId(), status: 'new', ...c }));

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'learning', label: 'Learning' },
  { key: 'known', label: 'Known' },
];

export default function Flashcards() {
  const [cards, setCards] = useState(SEED);
  const [order, setOrder] = useState(SEED.map((c) => c.id));
  const [currentId, setCurrentId] = useState(SEED[0].id);
  const [flipped, setFlipped] = useState(false);
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('study');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formFront, setFormFront] = useState('');
  const [formBack, setFormBack] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [justAdvanced, setJustAdvanced] = useState(null); // 'known' | 'learning' flash cue
  const frontInputRef = useRef(null);

  const visibleCards = useMemo(
    () => cards.filter((c) => (filter === 'all' ? true : c.status === filter)),
    [cards, filter]
  );
  const visibleIds = useMemo(() => new Set(visibleCards.map((c) => c.id)), [visibleCards]);
  const visibleOrder = useMemo(() => order.filter((id) => visibleIds.has(id)), [order, visibleIds]);

  useEffect(() => {
    if (visibleOrder.length === 0) {
      if (currentId !== null) setCurrentId(null);
      return;
    }
    if (!visibleOrder.includes(currentId)) {
      setCurrentId(visibleOrder[0]);
      setFlipped(false);
    }
  }, [visibleOrder.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentCard = cards.find((c) => c.id === currentId) || null;
  const currentIndex = currentId ? visibleOrder.indexOf(currentId) : -1;

  const total = cards.length;
  const knownCount = cards.filter((c) => c.status === 'known').length;
  const learningCount = cards.filter((c) => c.status === 'learning').length;
  const progressPct = total ? Math.round((knownCount / total) * 100) : 0;

  function goNext() {
    if (visibleOrder.length === 0) return;
    const idx = visibleOrder.indexOf(currentId);
    const next = idx === -1 ? 0 : (idx + 1) % visibleOrder.length;
    setCurrentId(visibleOrder[next]);
    setFlipped(false);
  }
  function goPrev() {
    if (visibleOrder.length === 0) return;
    const idx = visibleOrder.indexOf(currentId);
    const prev = idx === -1 ? 0 : (idx - 1 + visibleOrder.length) % visibleOrder.length;
    setCurrentId(visibleOrder[prev]);
    setFlipped(false);
  }
  function shuffleDeck() {
    setOrder((prev) => shuffleArr(prev));
    setFlipped(false);
  }
  function markStatus(status) {
    if (!currentId) return;
    setCards((prev) => prev.map((c) => (c.id === currentId ? { ...c, status } : c)));
    setJustAdvanced(status);
    setTimeout(() => setJustAdvanced(null), 400);
    goNext();
  }
  function resetProgress() {
    setCards((prev) => prev.map((c) => ({ ...c, status: 'new' })));
  }

  /* keyboard controls */
  useEffect(() => {
    function onKey(e) {
      if (view !== 'study') return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlipped((f) => !f); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, currentId, visibleOrder.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  /* form handlers */
  function openAddForm() {
    setEditingId(null); setFormFront(''); setFormBack(''); setFormCategory('');
    setShowForm(true);
    setTimeout(() => frontInputRef.current && frontInputRef.current.focus(), 50);
  }
  function openEditForm(card) {
    setEditingId(card.id); setFormFront(card.front); setFormBack(card.back); setFormCategory(card.category);
    setShowForm(true);
    setTimeout(() => frontInputRef.current && frontInputRef.current.focus(), 50);
  }
  function saveForm(e) {
    e.preventDefault();
    if (!formFront.trim() || !formBack.trim()) return;
    if (editingId) {
      setCards((prev) => prev.map((c) => (c.id === editingId
        ? { ...c, front: formFront.trim(), back: formBack.trim(), category: formCategory.trim() || 'General' }
        : c)));
    } else {
      const nc = { id: makeId(), front: formFront.trim(), back: formBack.trim(), category: formCategory.trim() || 'General', status: 'new' };
      setCards((prev) => [...prev, nc]);
      setOrder((prev) => [...prev, nc.id]);
    }
    setShowForm(false);
  }
  function deleteCard(id) {
    setCards((prev) => prev.filter((c) => c.id !== id));
    setOrder((prev) => prev.filter((o) => o !== id));
  }

  return (
    <div style={styles.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap');

        * { box-sizing: border-box; }
        .idx-scope { font-family: 'Inter', sans-serif; }
        .idx-scope ::selection { background: #F2C94C; color: #20241F; }

        .flip-scene { perspective: 1600px; }
        .flip-card { position: relative; width: 100%; height: 100%; transition: transform 0.55s cubic-bezier(.4,.2,.2,1); transform-style: preserve-3d; cursor: pointer; }
        .flip-card.is-flipped { transform: rotateY(180deg); }
        .flip-face { position: absolute; inset: 0; backface-visibility: hidden; border-radius: 10px; display: flex; flex-direction: column; }
        .flip-back { transform: rotateY(180deg); }

        .ruled { background-image: repeating-linear-gradient(to bottom, transparent, transparent 27px, rgba(32,36,31,0.10) 28px); }

        .punch-hole { width: 12px; height: 12px; border-radius: 50%; background: #20241F; box-shadow: inset 0 1px 2px rgba(0,0,0,0.4); }

        .stack-behind { position: absolute; inset: 0; border-radius: 10px; background: #E7DEC4; border: 1px solid rgba(32,36,31,0.15); }

        .cat-tab { position: absolute; top: -1px; right: 22px; padding: 4px 12px 6px; border-radius: 0 0 6px 6px; font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #F4EEDD; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }

        .btn { font-family: 'Inter', sans-serif; font-weight: 600; border: none; cursor: pointer; transition: transform 0.15s ease, background 0.15s ease, opacity 0.15s ease; }
        .btn:active { transform: scale(0.96); }
        .btn:focus-visible, .icon-btn:focus-visible, .tab-btn:focus-visible, input:focus-visible, textarea:focus-visible, .flip-card:focus-visible { outline: 2px solid #F2C94C; outline-offset: 2px; }
        .icon-btn { border: 1px solid rgba(244,238,221,0.18); background: rgba(244,238,221,0.06); cursor: pointer; transition: background 0.15s ease, transform 0.15s ease; }
        .icon-btn:hover { background: rgba(244,238,221,0.14); }
        .icon-btn:active { transform: scale(0.94); }

        .tab-btn { font-family: 'Inter', sans-serif; font-weight: 600; font-size: 13px; border: 1px solid rgba(244,238,221,0.15); background: transparent; color: #C9C4B3; cursor: pointer; transition: all 0.15s ease; }
        .tab-btn.active { background: #F4EEDD; color: #20241F; border-color: #F4EEDD; }

        .row-hover:hover { background: rgba(244,238,221,0.05); }

        @keyframes popIn { from { opacity: 0; transform: scale(0.94) translateY(4px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        .pop-in { animation: popIn 0.2s ease; }

        @media (prefers-reduced-motion: reduce) {
          .flip-card, .btn, .icon-btn, .tab-btn, .pop-in { transition: none !important; animation: none !important; }
        }

        @media (max-width: 560px) {
          .idx-header-row { flex-direction: column; align-items: flex-start !important; gap: 10px; }
          .idx-mark-row { flex-direction: column !important; }
          .idx-mark-row button { width: 100%; }
        }
      `}</style>

      <div className="idx-scope" style={styles.shell}>
        {/* header */}
        <div className="idx-header-row" style={styles.headerRow}>
          <div>
            <div style={styles.brandRow}>
              <Layers size={20} color="#F2C94C" />
              <h1 style={styles.brandTitle}>INDEX</h1>
            </div>
            <p style={styles.brandSub}>a deck for anything you're trying to learn</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="icon-btn"
              style={styles.viewToggleBtn}
              onClick={() => setView(view === 'study' ? 'manage' : 'study')}
            >
              {view === 'study' ? (
                <><Pencil size={14} /> Manage cards</>
              ) : (
                <><ArrowLeft size={14} /> Back to study</>
              )}
            </button>
          </div>
        </div>

        {view === 'study' ? (
          <StudyView
            cards={cards}
            filter={filter}
            setFilter={setFilter}
            visibleOrder={visibleOrder}
            currentCard={currentCard}
            currentIndex={currentIndex}
            flipped={flipped}
            setFlipped={setFlipped}
            goNext={goNext}
            goPrev={goPrev}
            shuffleDeck={shuffleDeck}
            markStatus={markStatus}
            resetProgress={resetProgress}
            justAdvanced={justAdvanced}
            total={total}
            knownCount={knownCount}
            learningCount={learningCount}
            progressPct={progressPct}
            openAddForm={openAddForm}
          />
        ) : (
          <ManageView
            cards={cards}
            openAddForm={openAddForm}
            openEditForm={openEditForm}
            deleteCard={deleteCard}
          />
        )}
      </div>

      {showForm && (
        <CardFormModal
          editingId={editingId}
          formFront={formFront}
          formBack={formBack}
          formCategory={formCategory}
          setFormFront={setFormFront}
          setFormBack={setFormBack}
          setFormCategory={setFormCategory}
          onSave={saveForm}
          onClose={() => setShowForm(false)}
          frontInputRef={frontInputRef}
        />
      )}
    </div>
  );
}

/* ================= Study View ================= */
function StudyView({
  cards, filter, setFilter, visibleOrder, currentCard, currentIndex, flipped, setFlipped,
  goNext, goPrev, shuffleDeck, markStatus, resetProgress, justAdvanced,
  total, knownCount, learningCount, progressPct, openAddForm,
}) {
  const stackDepth = Math.min(2, Math.max(0, visibleOrder.length - 1));

  return (
    <div className="pop-in">
      {/* filter tabs + stats */}
      <div style={styles.controlsRow}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => {
            const count = f.key === 'all' ? total : cards.filter((c) => c.status === f.key).length;
            return (
              <button
                key={f.key}
                className={`tab-btn ${filter === f.key ? 'active' : ''}`}
                style={styles.tabBtn}
                onClick={() => setFilter(f.key)}
              >
                {f.label} <span style={{ opacity: 0.6 }}>· {count}</span>
              </button>
            );
          })}
        </div>
        <div style={styles.statLine}>
          {total} card{total !== 1 ? 's' : ''} · {knownCount} known
        </div>
      </div>

      {/* card stage */}
      {currentCard ? (
        <>
          <div style={styles.stage}>
            <button className="icon-btn" style={styles.navArrow} onClick={goPrev} aria-label="Previous card">
              <ChevronLeft size={20} color="#F4EEDD" />
            </button>

            <div style={styles.cardWrap}>
              {Array.from({ length: stackDepth }).map((_, i) => (
                <div
                  key={i}
                  className="stack-behind"
                  style={{
                    transform: `rotate(${(i + 1) * (i % 2 === 0 ? 2.5 : -2.5)}deg) translateY(${(i + 1) * 4}px)`,
                    zIndex: i,
                    opacity: 0.6 - i * 0.15,
                  }}
                />
              ))}

              <div className="flip-scene" style={{ position: 'relative', zIndex: 10, width: '100%', height: '100%' }}>
                <div
                  className={`flip-card ${flipped ? 'is-flipped' : ''}`}
                  onClick={() => setFlipped((f) => !f)}
                  role="button"
                  tabIndex={0}
                  aria-label="Flashcard, click or press space to flip"
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFlipped((f) => !f); } }}
                >
                  {/* front */}
                  <div className="flip-face" style={styles.cardFace}>
                    <span className="cat-tab" style={{ background: colorForCategory(currentCard.category) }}>
                      {currentCard.category}
                    </span>
                    <div style={styles.holesRow}>
                      <div className="punch-hole" /><div className="punch-hole" />
                    </div>
                    <div style={styles.cardBody}>
                      <p style={styles.eyebrow}>Question</p>
                      <p style={styles.frontText}>{currentCard.front}</p>
                    </div>
                    <p style={styles.tapHint}>tap or press space to flip</p>
                  </div>
                  {/* back */}
                  <div className={`flip-face flip-back ruled`} style={{ ...styles.cardFace, background: '#EFE7CF' }}>
                    <span className="cat-tab" style={{ background: colorForCategory(currentCard.category) }}>
                      {currentCard.category}
                    </span>
                    <div style={styles.holesRow}>
                      <div className="punch-hole" /><div className="punch-hole" />
                    </div>
                    <div style={styles.cardBody}>
                      <p style={styles.eyebrow}>Answer</p>
                      <p style={styles.backText}>{currentCard.back}</p>
                    </div>
                    <p style={styles.tapHint}>tap to flip back</p>
                  </div>
                </div>
              </div>
            </div>

            <button className="icon-btn" style={styles.navArrow} onClick={goNext} aria-label="Next card">
              <ChevronRight size={20} color="#F4EEDD" />
            </button>
          </div>

          <div style={styles.posRow}>
            <button className="icon-btn" style={styles.smallIconBtn} onClick={shuffleDeck} aria-label="Shuffle deck">
              <Shuffle size={14} />
            </button>
            <span style={styles.posText}>{currentIndex + 1} / {visibleOrder.length}</span>
            <button className="icon-btn" style={styles.smallIconBtn} onClick={resetProgress} aria-label="Reset progress">
              <RotateCcw size={14} />
            </button>
          </div>

          {/* mark buttons */}
          <div className="idx-mark-row" style={styles.markRow}>
            <button
              className="btn"
              style={{ ...styles.markBtn, background: '#C1502E', color: '#F4EEDD', opacity: justAdvanced === 'learning' ? 0.7 : 1 }}
              onClick={() => markStatus('learning')}
            >
              <X size={16} /> Still learning
            </button>
            <button
              className="btn"
              style={{ ...styles.markBtn, background: '#2F6F63', color: '#F4EEDD', opacity: justAdvanced === 'known' ? 0.7 : 1 }}
              onClick={() => markStatus('known')}
            >
              <Check size={16} /> Got it
            </button>
          </div>

          {/* progress bar */}
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${progressPct}%` }} />
          </div>
          <p style={styles.progressLabel}>{progressPct}% of the whole deck marked known</p>
        </>
      ) : (
        <EmptyState filter={filter} onAdd={openAddForm} />
      )}
    </div>
  );
}

function EmptyState({ filter, onAdd }) {
  const msg = filter === 'all'
    ? "Your deck is empty. Add a card to start studying."
    : `No cards are marked "${filter}" right now.`;
  return (
    <div style={styles.emptyState}>
      <BookOpen size={28} color="#8A8574" />
      <p style={styles.emptyText}>{msg}</p>
      {filter === 'all' && (
        <button className="btn" style={styles.addBtn} onClick={onAdd}>
          <Plus size={16} /> Add your first card
        </button>
      )}
    </div>
  );
}

/* ================= Manage View ================= */
function ManageView({ cards, openAddForm, openEditForm, deleteCard }) {
  return (
    <div className="pop-in">
      <div style={styles.manageHeader}>
        <p style={styles.manageCount}>{cards.length} card{cards.length !== 1 ? 's' : ''} in this deck</p>
        <button className="btn" style={styles.addBtn} onClick={openAddForm}>
          <Plus size={16} /> Add card
        </button>
      </div>

      {cards.length === 0 ? (
        <EmptyState filter="all" onAdd={openAddForm} />
      ) : (
        <div style={styles.manageList}>
          {cards.map((c) => (
            <div key={c.id} className="row-hover" style={styles.manageRow}>
              <span style={{ ...styles.catChip, background: colorForCategory(c.category) }}>{c.category}</span>
              <div style={styles.manageRowText}>
                <p style={styles.manageFront}>{c.front}</p>
                <p style={styles.manageBack}>{c.back}</p>
              </div>
              <span style={{ ...styles.statusChip, ...statusChipStyle(c.status) }}>{c.status}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="icon-btn" style={styles.smallIconBtn} onClick={() => openEditForm(c)} aria-label="Edit card">
                  <Pencil size={14} />
                </button>
                <button className="icon-btn" style={styles.smallIconBtn} onClick={() => deleteCard(c.id)} aria-label="Delete card">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function statusChipStyle(status) {
  if (status === 'known') return { background: 'rgba(47,111,99,0.2)', color: '#7FC9B8' };
  if (status === 'learning') return { background: 'rgba(193,80,46,0.2)', color: '#E8A088' };
  return { background: 'rgba(244,238,221,0.1)', color: '#C9C4B3' };
}

/* ================= Add/Edit Modal ================= */
function CardFormModal({
  editingId, formFront, formBack, formCategory,
  setFormFront, setFormBack, setFormCategory, onSave, onClose, frontInputRef,
}) {
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <form
        className="pop-in"
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSave}
      >
        <div style={styles.modalHeaderRow}>
          <h2 style={styles.modalTitle}>{editingId ? 'Edit card' : 'New card'}</h2>
          <button type="button" className="icon-btn" style={styles.smallIconBtn} onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <label style={styles.formLabel}>Question (front)</label>
        <textarea
          ref={frontInputRef}
          style={styles.textarea}
          value={formFront}
          onChange={(e) => setFormFront(e.target.value)}
          placeholder="What is the capital of Australia?"
          rows={2}
          required
        />

        <label style={styles.formLabel}>Answer (back)</label>
        <textarea
          style={styles.textarea}
          value={formBack}
          onChange={(e) => setFormBack(e.target.value)}
          placeholder="Canberra"
          rows={2}
          required
        />

        <label style={styles.formLabel}>Category</label>
        <input
          style={styles.input}
          value={formCategory}
          onChange={(e) => setFormCategory(e.target.value)}
          placeholder="General"
        />

        <div style={styles.modalActions}>
          <button type="button" className="btn" style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" style={styles.saveBtn}>
            {editingId ? 'Save changes' : 'Add card'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ================= styles ================= */
const styles = {
  app: {
    minHeight: '100%',
    width: '100%',
    background: '#20241F',
    backgroundImage: 'radial-gradient(circle at 20% 10%, rgba(244,238,221,0.05), transparent 40%), radial-gradient(circle at 90% 80%, rgba(47,111,99,0.08), transparent 45%)',
    padding: '32px 16px 48px',
    display: 'flex',
    justifyContent: 'center',
  },
  shell: { width: '100%', maxWidth: 640 },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 },
  brandRow: { display: 'flex', alignItems: 'center', gap: 8 },
  brandTitle: { fontFamily: "'Fraunces', serif", fontSize: 30, fontWeight: 700, color: '#F4EEDD', letterSpacing: '0.02em', margin: 0 },
  brandSub: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: '#8A8574', margin: '4px 0 0 28px' },
  viewToggleBtn: { display: 'flex', alignItems: 'center', gap: 6, color: '#F4EEDD', fontSize: 13, fontWeight: 600, fontFamily: "'Inter', sans-serif", padding: '9px 14px', borderRadius: 8 },

  controlsRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 },
  tabBtn: { padding: '7px 12px', borderRadius: 20 },
  statLine: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#8A8574' },

  stage: { display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' },
  navArrow: { width: 40, height: 40, minWidth: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  cardWrap: { position: 'relative', width: 320, maxWidth: '100%', height: 340 },

  cardFace: {
    background: '#F4EEDD',
    border: '1px solid rgba(32,36,31,0.15)',
    boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
    padding: '22px 22px 16px',
    overflow: 'hidden',
  },
  holesRow: { display: 'flex', gap: 10, marginBottom: 10 },
  cardBody: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 },
  eyebrow: { fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8A8574', margin: 0 },
  frontText: { fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, color: '#23271F', lineHeight: 1.35, margin: 0 },
  backText: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 16, color: '#23271F', lineHeight: 1.6, margin: 0 },
  tapHint: { fontFamily: "'Inter', sans-serif", fontSize: 11, color: '#A39D89', textAlign: 'center', margin: 0 },

  posRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 16 },
  posText: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: '#C9C4B3' },
  smallIconBtn: { width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F4EEDD' },

  markRow: { display: 'flex', gap: 10, marginTop: 22, justifyContent: 'center' },
  markBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '12px 20px', borderRadius: 10, fontSize: 14, flex: 1, maxWidth: 200 },

  progressTrack: { height: 6, borderRadius: 4, background: 'rgba(244,238,221,0.08)', marginTop: 24, overflow: 'hidden' },
  progressFill: { height: '100%', background: 'linear-gradient(90deg, #2F6F63, #F2C94C)', transition: 'width 0.4s ease' },
  progressLabel: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#8A8574', textAlign: 'center', marginTop: 8 },

  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '60px 20px', textAlign: 'center' },
  emptyText: { fontFamily: "'Inter', sans-serif", fontSize: 14, color: '#8A8574', maxWidth: 280, margin: 0 },
  addBtn: { display: 'flex', alignItems: 'center', gap: 6, background: '#F2C94C', color: '#20241F', padding: '10px 16px', borderRadius: 9, fontSize: 13.5 },

  manageHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  manageCount: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: '#8A8574', margin: 0 },
  manageList: { display: 'flex', flexDirection: 'column', gap: 2, borderTop: '1px solid rgba(244,238,221,0.08)' },
  manageRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 6px', borderBottom: '1px solid rgba(244,238,221,0.08)' },
  manageRowText: { flex: 1, minWidth: 0 },
  manageFront: { fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: '#F4EEDD', margin: 0, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  manageBack: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#8A8574', margin: '2px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  catChip: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#F4EEDD', padding: '4px 8px', borderRadius: 5, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em' },
  statusChip: { fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 12, whiteSpace: 'nowrap', textTransform: 'capitalize' },

  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(15,17,13,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 100 },
  modal: { background: '#2A2F27', border: '1px solid rgba(244,238,221,0.1)', borderRadius: 14, padding: 22, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' },
  modalHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, color: '#F4EEDD', margin: 0 },
  formLabel: { fontFamily: "'Inter', sans-serif", fontSize: 11.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#8A8574', marginTop: 12, marginBottom: 6 },
  textarea: { fontFamily: "'Inter', sans-serif", fontSize: 14, color: '#F4EEDD', background: 'rgba(244,238,221,0.06)', border: '1px solid rgba(244,238,221,0.14)', borderRadius: 8, padding: '9px 11px', resize: 'vertical' },
  input: { fontFamily: "'Inter', sans-serif", fontSize: 14, color: '#F4EEDD', background: 'rgba(244,238,221,0.06)', border: '1px solid rgba(244,238,221,0.14)', borderRadius: 8, padding: '9px 11px' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
  cancelBtn: { background: 'transparent', color: '#C9C4B3', padding: '9px 16px', borderRadius: 8, fontSize: 13.5, border: '1px solid rgba(244,238,221,0.14)' },
  saveBtn: { background: '#F2C94C', color: '#20241F', padding: '9px 18px', borderRadius: 8, fontSize: 13.5 },
};
