/**
 * useMarkdownComponents hook - Provides ReactMarkdown component overrides.
 * 
 * This hook handles:
 * - Heading components with auto-generated IDs for anchor linking
 * - Code block rendering with Mermaid diagram support
 * - Clickable Mermaid diagrams that open in media viewer
 */

import { useMemo } from "react";
import { generateHeadingId } from "../utils/helpers";
import { MermaidCode } from "../components";
import type { MediaContent } from "../components";

export interface UseMarkdownComponentsOptions {
  /** Callback to set media viewer content */
  setMediaViewerContent: (content: MediaContent | null) => void;
  /** Callback to set the maximized pane */
  setMaximizedPane: (pane: 'source' | 'preview' | 'media' | null) => void;
}

export interface MarkdownComponents {
  h1: React.FC<any>;
  h2: React.FC<any>;
  h3: React.FC<any>;
  h4: React.FC<any>;
  h5: React.FC<any>;
  h6: React.FC<any>;
  code: React.FC<any>;
}

/**
 * Hook for creating memoized ReactMarkdown component overrides.
 * 
 * Features:
 * - All heading levels (h1-h6) generate IDs from their text content
 * - Code blocks detect `language-mermaid` and render as interactive diagrams
 * - Mermaid diagrams are clickable and open in fullscreen media viewer
 */
export function useMarkdownComponents(options: UseMarkdownComponentsOptions): MarkdownComponents {
  const { setMediaViewerContent, setMaximizedPane } = options;

  return useMemo(() => ({
    h1: ({ children, ...props }: any) => {
      const id = generateHeadingId(String(children));
      return <h1 id={id} {...props}>{children}</h1>;
    },
    h2: ({ children, ...props }: any) => {
      const id = generateHeadingId(String(children));
      return <h2 id={id} {...props}>{children}</h2>;
    },
    h3: ({ children, ...props }: any) => {
      const id = generateHeadingId(String(children));
      return <h3 id={id} {...props}>{children}</h3>;
    },
    h4: ({ children, ...props }: any) => {
      const id = generateHeadingId(String(children));
      return <h4 id={id} {...props}>{children}</h4>;
    },
    h5: ({ children, ...props }: any) => {
      const id = generateHeadingId(String(children));
      return <h5 id={id} {...props}>{children}</h5>;
    },
    h6: ({ children, ...props }: any) => {
      const id = generateHeadingId(String(children));
      return <h6 id={id} {...props}>{children}</h6>;
    },
    code: ({ className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : null;
      
      if (language === 'mermaid') {
        const mermaidContent = String(children).trim();
        return (
          <div 
            onClick={() => {
              setMediaViewerContent({ type: 'mermaid', content: mermaidContent });
              setMaximizedPane('media');
            }}
            className="mermaid-clickable"
            title="Click to view fullscreen"
          >
            <MermaidCode>{mermaidContent}</MermaidCode>
          </div>
        );
      }
      
      return <code className={className} {...props}>{children}</code>;
    },
  }), [setMediaViewerContent, setMaximizedPane]);
}
