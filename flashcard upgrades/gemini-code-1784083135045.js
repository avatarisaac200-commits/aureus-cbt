import React, { useState } from 'react';

// Initial dummy data to start with
const INITIAL_CARDS = [
  { id: 1, question: "What is the virtual DOM in React?", answer: "A lightweight representation of the real DOM kept in memory and synced with the real DOM via reconciliation." },
  { id: 2, question: "What is the difference between state and props?", answer: "State is managed within the component (mutable), whereas props are passed to the component (immutable)." },
  { id: 3, question: "What does the 'key' prop do in React lists?", answer: "It helps React identify which items have changed, been added, or been removed, ensuring efficient re-rendering." },
  { id: 4, question: "What is a pure component?", answer: "A component that renders the exact same output given the same props and state." }
];

export default function FlashcardApp() {
  const [cards, setCards] = useState(INITIAL_CARDS);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  
  // Form State for adding new cards
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');

  const currentCard = cards[currentIndex];

  const handleNext = () => {
    setIsFlipped(false);
    // Tiny timeout to let the card unflip before changing the text
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % cards.length);
    }, 150);
  };

  const handlePrev = () => {
    setIsFlipped(false);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev - 1 + cards.length) % cards.length);
    }, 150);
  };

  const handleScore = (isCorrect) => {
    setScore(prev => ({
      correct: prev.correct + (isCorrect ? 1 : 0),
      total: prev.total + 1
    }));
    handleNext();
  };

  const handleAddCard = (e) => {
    e.preventDefault();
    if (!newQuestion.trim() || !newAnswer.trim()) return;

    const newCard = {
      id: Date.now(),
      question: newQuestion,
      answer: newAnswer
    };

    setCards([...cards, newCard]);
    setNewQuestion('');
    setNewAnswer('');
  };

  const handleResetScore = () => {
    setScore({ correct: 0, total: 0 });
  };

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 text-slate-800 font-sans flex flex-col items-center">
      
      {/* Header */}
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-extrabold text-indigo-600 tracking-tight">
          🧠 FlashLearn
        </h1>
        <p className="text-slate-500 mt-2">Master your topics one card at a time</p>
      </header>

      <div className="w-full max-w-4xl grid md:grid-cols-3 gap-8">
        
        {/* Left Side: Create Card Form & Stats */}
        <div className="space-y-6 md:col-span-1">
          {/* Scoreboard */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-700 mb-4">Your Progress</h2>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-3xl font-black text-indigo-600">
                  {score.correct}<span className="text-sm text-slate-400 font-normal">/{score.total}</span>
                </p>
                <p className="text-xs text-slate-400 mt-1">Correct Answers</p>
              </div>
              <button 
                onClick={handleResetScore}
                className="text-xs font-semibold text-slate-400 hover:text-rose-500 transition-colors"
              >
                Reset Stats
              </button>
            </div>
            
            {/* Simple progress bar */}
            {score.total > 0 && (
              <div className="w-full bg-slate-100 rounded-full h-2 mt-4 overflow-hidden">
                <div 
                  className="bg-emerald-500 h-2 transition-all duration-300"
                  style={{ width: `${(score.correct / score.total) * 100}%` }}
                ></div>
              </div>
            )}
          </div>

          {/* Add New Card */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-700 mb-4">Add Custom Card</h2>
            <form onSubmit={handleAddCard} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Question</label>
                <textarea
                  required
                  rows="2"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  placeholder="e.g., What is closure?"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Answer</label>
                <textarea
                  required
                  rows="2"
                  value={newAnswer}
                  onChange={(e) => setNewAnswer(e.target.value)}
                  placeholder="e.g., An inner function that has access to outer variables..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 rounded-lg text-sm transition-colors shadow-sm"
              >
                Add Card
              </button>
            </form>
          </div>
        </div>

        {/* Right Side: Flashcard Arena */}
        <div className="md:col-span-2 flex flex-col items-center justify-start">
          {cards.length > 0 ? (
            <div className="w-full max-w-lg">
              
              {/* Card Flip Container */}
              <div 
                className="w-full h-80 cursor-pointer group [perspective:1000px]"
                onClick={() => setIsFlipped(!isFlipped)}
              >
                <div className={`relative w-full h-full transition-transform duration-500 [transform-style:preserve-3d] ${isFlipped ? '[transform:rotateY(180deg)]' : ''}`}>
                  
                  {/* Front Side */}
                  <div className="absolute inset-0 w-full h-full bg-white rounded-2xl shadow-md border border-slate-100 flex flex-col justify-between p-8 [backface-visibility:hidden]">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-indigo-500 uppercase tracking-widest">Question</span>
                      <span className="text-xs text-slate-400">Card {currentIndex + 1} of {cards.length}</span>
                    </div>
                    <div className="my-auto text-center">
                      <h3 className="text-xl md:text-2xl font-bold text-slate-800 leading-snug">
                        {currentCard.question}
                      </h3>
                    </div>
                    <div className="text-center text-xs text-slate-400 animate-pulse">
                      Click card to reveal answer
                    </div>
                  </div>

                  {/* Back Side */}
                  <div className="absolute inset-0 w-full h-full bg-indigo-50 text-slate-800 rounded-2xl shadow-md border border-indigo-100 flex flex-col justify-between p-8 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-emerald-600 uppercase tracking-widest">Answer</span>
                      <span className="text-xs text-slate-400">Card {currentIndex + 1} of {cards.length}</span>
                    </div>
                    <div className="my-auto text-center overflow-y-auto max-h-40 px-2">
                      <p className="text-lg md:text-xl font-medium text-slate-700 leading-relaxed">
                        {currentCard.answer}
                      </p>
                    </div>
                    <div className="text-center text-xs text-slate-400">
                      Click card to view question
                    </div>
                  </div>

                </div>
              </div>

              {/* Navigation and Score Controls */}
              <div className="mt-6 flex flex-col items-center gap-4">
                
                {/* Score logger (shows up when card is flipped) */}
                <div className={`flex items-center gap-3 transition-opacity duration-300 ${isFlipped ? 'opacity-100' : 'opacity-20 pointer-events-none'}`}>
                  <span className="text-xs font-semibold text-slate-500">Did you get it right?</span>
                  <button 
                    onClick={() => handleScore(false)}
                    className="px-3 py-1 bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs font-bold rounded-full transition-colors"
                  >
                    ❌ No
                  </button>
                  <button 
                    onClick={() => handleScore(true)}
                    className="px-3 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-xs font-bold rounded-full transition-colors"
                  >
                    ✅ Yes
                  </button>
                </div>

                {/* Left/Right Controls */}
                <div className="flex items-center gap-6 mt-2">
                  <button 
                    onClick={handlePrev}
                    className="p-3 bg-white hover:bg-slate-100 text-slate-600 rounded-full shadow-sm border border-slate-100 transition-colors"
                    aria-label="Previous Card"
                  >
                    ←
                  </button>
                  <span className="text-sm font-semibold text-slate-500">
                    {currentIndex + 1} / {cards.length}
                  </span>
                  <button 
                    onClick={handleNext}
                    className="p-3 bg-white hover:bg-slate-100 text-slate-600 rounded-full shadow-sm border border-slate-100 transition-colors"
                    aria-label="Next Card"
                  >
                    →
                  </button>
                </div>

              </div>

            </div>
          ) : (
            <div className="bg-white p-10 rounded-2xl shadow-sm border border-slate-100 text-center w-full max-w-lg">
              <p className="text-slate-400 mb-4">No cards available. Create one to get started!</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}