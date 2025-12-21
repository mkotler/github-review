/**
 * MermaidCode component for rendering Mermaid diagrams.
 * Uses the mermaid.js library to parse and render diagram syntax.
 */

import { useRef, useState, useEffect } from "react";
import mermaid from "mermaid";

// Initialize Mermaid configuration
mermaid.initialize({
  startOnLoad: true,
  theme: 'default',
  securityLevel: 'loose',
});

export interface MermaidCodeProps {
  /** Mermaid diagram syntax as a string */
  children: string;
}

/**
 * Component that renders Mermaid diagrams from text syntax.
 * 
 * Features:
 * - Parses and renders Mermaid diagram syntax
 * - Handles render errors gracefully
 * - Memoizes rendered content to prevent re-renders
 * - Generates unique IDs for each diagram instance
 * 
 * @example
 * <MermaidCode>
 *   {`graph TD
 *     A[Start] --> B[Process]
 *     B --> C[End]`}
 * </MermaidCode>
 */
export function MermaidCode({ children }: MermaidCodeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const renderedContentRef = useRef<string>('');

  useEffect(() => {
    // Skip if we've already rendered this exact content
    if (renderedContentRef.current === children) {
      return;
    }
    
    if (ref.current && typeof children === 'string') {
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
      mermaid.render(id, children)
        .then(({ svg }) => {
          if (ref.current) {
            ref.current.innerHTML = svg;
            renderedContentRef.current = children;
          }
        })
        .catch((err) => {
          console.error('Mermaid render error:', err);
          setError(err.message || 'Failed to render diagram');
        });
    }
  }, [children]);

  if (error) {
    return <pre className="mermaid-error">Mermaid Error: {error}</pre>;
  }

  return <div ref={ref} className="mermaid-diagram" />;
}

export default MermaidCode;
