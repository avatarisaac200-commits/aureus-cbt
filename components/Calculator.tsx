import React, { useState } from 'react';

interface CalculatorProps {
  onClose: () => void;
}

const Calculator: React.FC<CalculatorProps> = ({ onClose }) => {
  const [display, setDisplay] = useState('0');

  const handleDigit = (d: string) => {
    setDisplay(prev => prev === '0' ? d : prev + d);
  };

  const handleClear = () => setDisplay('0');

  const handleEval = () => {
    try {
      const sanitized = display.replace('×', '*').replace('÷', '/').replace(/[^-+*/.0-9]/g, '');
      const result = new Function(`return ${sanitized}`)();
      setDisplay(String(result));
    } catch {
      setDisplay('Error');
    }
  };

  const handleOp = (op: string) => {
    setDisplay(prev => prev + op);
  };

  const handleSci = (func: string) => {
    const val = parseFloat(display);
    if (isNaN(val)) return setDisplay('Error');
    let result = 0;
    switch(func) {
      case 'sin': result = Math.sin(val); break;
      case 'cos': result = Math.cos(val); break;
      case 'tan': result = Math.tan(val); break;
      case 'log': result = Math.log10(val); break;
      case 'ln': result = Math.log(val); break;
      case 'exp': result = Math.exp(val); break;
      case 'sqrt': result = Math.sqrt(val); break;
    }
    setDisplay(String(Number(result.toFixed(6))));
  };

  return (
    <div className="fixed bottom-20 right-4 sm:bottom-24 sm:right-8 w-64 sm:w-72 bg-slate-900 border-2 border-slate-800 rounded-2xl shadow-2xl p-4 z-[60] text-white">
      <div className="flex justify-between items-center mb-3">
        <span className="text-[9px] font-black uppercase tracking-widest text-amber-500">Scientific Engine</span>
        <button onClick={onClose} className="p-1 hover:text-red-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>
      
      <div className="bg-slate-950 rounded-xl p-3 mb-4 text-right border border-slate-800 overflow-hidden">
        <span className="text-xl sm:text-2xl font-mono truncate block text-amber-400">{display}</span>
      </div>

      <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
        <button onClick={() => handleSci('sin')} className="bg-slate-800 p-2 rounded-lg text-[9px] font-black hover:bg-slate-700">SIN</button>
        <button onClick={() => handleSci('cos')} className="bg-slate-800 p-2 rounded-lg text-[9px] font-black hover:bg-slate-700">COS</button>
        <button onClick={() => handleSci('ln')} className="bg-amber-600/20 text-amber-500 p-2 rounded-lg text-[9px] font-black hover:bg-amber-600/30">LN</button>
        <button onClick={() => handleSci('exp')} className="bg-amber-600/20 text-amber-500 p-2 rounded-lg text-[9px] font-black hover:bg-amber-600/30">EXP</button>
        
        <button onClick={() => handleSci('log')} className="bg-slate-800 p-2 rounded-lg text-[9px] font-black hover:bg-slate-700">LOG</button>
        <button onClick={() => handleSci('sqrt')} className="bg-slate-800 p-2 rounded-lg text-[9px] font-black hover:bg-slate-700">√</button>
        <button onClick={handleClear} className="bg-rose-600 p-2 rounded-lg text-[9px] font-black hover:bg-rose-500">AC</button>
        <button onClick={() => handleOp('÷')} className="bg-slate-700 p-2 rounded-lg text-lg font-bold hover:bg-slate-600">÷</button>

        {[7,8,9].map(n => <button key={n} onClick={() => handleDigit(String(n))} className="bg-slate-800 p-2.5 sm:p-3 rounded-lg font-black hover:bg-slate-700">{n}</button>)}
        <button onClick={() => handleOp('×')} className="bg-slate-700 p-2.5 sm:p-3 rounded-lg text-lg font-bold hover:bg-slate-600">×</button>

        {[4,5,6].map(n => <button key={n} onClick={() => handleDigit(String(n))} className="bg-slate-800 p-2.5 sm:p-3 rounded-lg font-black hover:bg-slate-700">{n}</button>)}
        <button onClick={() => handleOp('-')} className="bg-slate-700 p-2.5 sm:p-3 rounded-lg text-lg font-bold hover:bg-slate-600">-</button>

        {[1,2,3].map(n => <button key={n} onClick={() => handleDigit(String(n))} className="bg-slate-800 p-2.5 sm:p-3 rounded-lg font-black hover:bg-slate-700">{n}</button>)}
        <button onClick={() => handleOp('+')} className="bg-slate-700 p-2.5 sm:p-3 rounded-lg text-lg font-bold hover:bg-slate-600">+</button>

        <button onClick={() => handleDigit('0')} className="bg-slate-800 p-2.5 sm:p-3 rounded-lg font-black hover:bg-slate-700 col-span-2">0</button>
        <button onClick={() => handleDigit('.')} className="bg-slate-800 p-2.5 sm:p-3 rounded-lg font-black hover:bg-slate-700">.</button>
        <button onClick={handleEval} className="bg-amber-500 text-slate-950 p-2.5 sm:p-3 rounded-lg font-black hover:bg-amber-400">=</button>
      </div>
    </div>
  );
};

export default Calculator;