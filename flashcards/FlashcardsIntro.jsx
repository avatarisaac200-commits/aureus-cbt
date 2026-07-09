import { useEffect, useState } from "react";

/**
 * FlashcardsIntro
 * A full-screen, once-per-login announcement animation for a new
 * "Flashcards" feature. Built as a self-contained mock so it can be
 * previewed on its own — see the accompanying Codex prompt for how
 * to wire real "has this person already seen it" logic into an
 * existing app.
 */

const CARD_COUNT = 4;

export default function FlashcardsIntro() {
  const [phase, setPhase] = useState("closed"); // closed | entering | flipped | leaving
  const [seen, setSeen] = useState(false);

  const play = () => {
    setSeen(true);
    setPhase("entering");
    // fan the cards in, then flip the top one, then settle
    const t1 = setTimeout(() => setPhase("flipped"), 900);
    return () => clearTimeout(t1);
  };

  useEffect(() => {
    // Mock "plays once on login": nothing has been seen yet this session.
    const already = false;
    if (!already) {
      const cleanup = play();
      return cleanup;
    }
  }, []);

  const dismiss = () => {
    setPhase("leaving");
    setTimeout(() => setPhase("closed"), 500);
  };

  return (
    <div style={styles.stage}>
      <style>{css}</style>

      {phase === "closed" && (
        <button style={styles.replay} onClick={play}>
          ↺ Replay intro (demo only)
        </button>
      )}

      {phase !== "closed" && (
        <div
          className={`overlay ${phase === "leaving" ? "overlay-out" : "overlay-in"}`}
          role="dialog"
          aria-label="Introducing Flashcards"
        >
          <div className="glow" />

          <div className="deck">
            {Array.from({ length: CARD_COUNT }).map((_, i) => {
              const isTop = i === CARD_COUNT - 1;
              return (
                <div
                  key={i}
                  className={`card card-${i} ${phase === "entering" ? "card-fan" : ""} ${
                    isTop && phase === "flipped" ? "card-flip" : ""
                  }`}
                >
                  <div className="card-face card-face-back" />
                  {isTop ? (
                    <div className="card-face card-face-front">
                      <span className="dogear" />
                      <span className="eyebrow">New in your deck</span>
                      <h1 className="headline">Introducing Flashcards</h1>
                      <p className="sub">
                        Turn any note into a quick round of recall. Flip, remember,
                        move on.
                      </p>
                      <div className="actions">
                        <button className="cta" onClick={dismiss}>
                          Try it now
                        </button>
                        <button className="ghost" onClick={dismiss}>
                          Maybe later
                        </button>
                      </div>
                      <span className="spark spark-a">✳</span>
                      <span className="spark spark-b">✳</span>
                    </div>
                  ) : (
                    <div className="card-face card-face-blank" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  stage: {
    minHeight: "480px",
    width: "100%",
    background: "#0F1626",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    fontFamily: "Inter, system-ui, sans-serif",
    overflow: "hidden",
    borderRadius: "12px",
  },
  replay: {
    background: "#1B2A4A",
    color: "#F7F1E3",
    border: "1px solid #33456b",
    padding: "10px 16px",
    borderRadius: "999px",
    fontSize: "13px",
    cursor: "pointer",
  },
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,600;9..144,700&family=Inter:wght@400;500;600&display=swap');

.overlay {
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 120% at 50% 20%, #1B2A4A 0%, #0F1626 70%);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.overlay-in { animation: fadeIn 0.4s ease-out; }
.overlay-out { animation: fadeOut 0.5s ease-in forwards; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }

.glow {
  position: absolute;
  width: 520px;
  height: 520px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(232,93,47,0.25) 0%, rgba(232,93,47,0) 70%);
  animation: pulse 2.4s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 0.7; }
  50% { transform: scale(1.15); opacity: 1; }
}

.deck {
  position: relative;
  width: 320px;
  height: 380px;
  perspective: 1400px;
}

.card {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 300px;
  height: 360px;
  transform-style: preserve-3d;
  transition: transform 0.7s cubic-bezier(.2,.8,.2,1);
  transform: translateY(40px) scale(0.9) rotate(0deg);
  opacity: 0;
}

/* fanned resting positions, back cards peeking out behind the top one */
.card-fan.card-0 { transform: translate(-26px, 10px) rotate(-10deg); opacity: 1; transition-delay: 0.02s; }
.card-fan.card-1 { transform: translate(-10px, 4px) rotate(-4deg); opacity: 1; transition-delay: 0.08s; }
.card-fan.card-2 { transform: translate(10px, 4px) rotate(4deg); opacity: 1; transition-delay: 0.14s; }
.card-fan.card-3 { transform: translate(0px, 0px) rotate(0deg); opacity: 1; transition-delay: 0.2s; }

.card-flip {
  transform: translate(0px, 0px) rotate(0deg) rotateY(180deg) !important;
  transition: transform 0.8s cubic-bezier(.3,.7,.2,1);
}

.card-face {
  position: absolute;
  inset: 0;
  border-radius: 14px;
  backface-visibility: hidden;
  box-shadow: 0 20px 40px rgba(0,0,0,0.35);
}

.card-face-blank {
  background: #F7F1E3;
  border: 1px solid #e6dcc4;
}

.card-face-back {
  background: linear-gradient(160deg, #24365C, #1B2A4A);
  border: 1px solid #33456b;
}

.card-face-front {
  background: #F7F1E3;
  color: #24262B;
  transform: rotateY(180deg);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 34px 28px;
  text-align: left;
  overflow: hidden;
}

.dogear {
  position: absolute;
  top: 0;
  right: 0;
  width: 34px;
  height: 34px;
  background: #E85D2F;
  clip-path: polygon(100% 0, 0 0, 100% 100%);
}

.eyebrow {
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #6B9080;
  font-weight: 600;
  margin-bottom: 10px;
}

.headline {
  font-family: 'Fraunces', serif;
  font-weight: 600;
  font-size: 30px;
  line-height: 1.08;
  margin: 0 0 12px 0;
  color: #1B2A4A;
}

.sub {
  font-size: 14px;
  line-height: 1.5;
  color: #4b4d53;
  margin: 0 0 22px 0;
}

.actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.cta {
  background: #E85D2F;
  color: #F7F1E3;
  border: none;
  padding: 11px 20px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.cta:hover { background: #d4501f; }

.ghost {
  background: none;
  border: none;
  color: #6b7280;
  font-size: 13px;
  cursor: pointer;
  text-decoration: underline;
}

.spark {
  position: absolute;
  color: #E8B550;
  font-size: 16px;
  opacity: 0;
  animation: sparkIn 0.6s ease-out 0.9s forwards;
}
.spark-a { top: 18px; left: 18px; }
.spark-b { bottom: 22px; right: 26px; animation-delay: 1.05s; }
@keyframes sparkIn {
  from { opacity: 0; transform: scale(0.4) rotate(-15deg); }
  to { opacity: 1; transform: scale(1) rotate(0deg); }
}

@media (prefers-reduced-motion: reduce) {
  .card, .overlay-in, .overlay-out, .glow, .spark { animation: none !important; transition: none !important; }
  .card-fan, .card-flip { transform: none !important; opacity: 1 !important; }
}
`;
