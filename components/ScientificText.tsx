import React, { useEffect, useRef } from 'react';

interface ScientificTextProps {
  text: string;
  className?: string;
}

declare global {
  interface Window {
    MathJax: any;
  }
}

/**
 * Renders scientific notation:
 * - Supports MathJax (LaTeX via $...$ or \(...\))
 * - Legacy support for: ^{text}, _{text}, [num/den]
 */
const ScientificText: React.FC<ScientificTextProps> = ({ text, className = "" }) => {
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (window.MathJax && window.MathJax.typesetPromise && containerRef.current) {
      window.MathJax.typesetPromise([containerRef.current]).catch((err: any) => 
        console.warn('MathJax typesetting failed:', err)
      );
    }
  }, [text]);

  if (!text) return null;

  // Split by legacy patterns or math patterns if needed
  // For now, we mainly rely on MathJax if the user provides $...$
  // But we still process the custom ^{} and _{} for backward compatibility
  const parts = text.split(/(\^\{[^}]+\}|\^[\w\d]|_{[^}]+}|_[\w\d]|\[[^\]]+\/[^\]]+\])/g);

  return (
    <span ref={containerRef} className={`tex2jax_process inline-block ${className}`}>
      {parts.map((part, i) => {
        if (part.startsWith('^{')) {
          return <sup key={i} className="text-[0.8em]">{part.slice(2, -1)}</sup>;
        }
        if (part.startsWith('^')) {
          return <sup key={i} className="text-[0.8em]">{part.slice(1)}</sup>;
        }
        if (part.startsWith('_{')) {
          return <sub key={i} className="text-[0.8em]">{part.slice(2, -1)}</sub>;
        }
        if (part.startsWith('_')) {
          return <sub key={i} className="text-[0.8em]">{part.slice(1)}</sub>;
        }
        if (part.startsWith('[') && part.includes('/')) {
          const splitPoint = part.indexOf('/');
          const num = part.slice(1, splitPoint);
          const den = part.slice(splitPoint + 1, -1);
          return (
            <span key={i} className="inline-flex flex-col align-middle text-center px-0.5 leading-none text-[0.85em]">
              <span className="border-b border-current pb-0.5">{num}</span>
              <span className="pt-0.5">{den}</span>
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
};

export default ScientificText;