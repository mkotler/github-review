/**
 * MediaViewer - Full-screen overlay for viewing images and Mermaid diagrams
 */

import { MermaidCode } from "./MermaidCode";

export interface MediaContent {
  type: 'image' | 'mermaid';
  content: string;
}

export interface MediaViewerProps {
  content: MediaContent;
  onClose: () => void;
}

/**
 * Full-screen media viewer overlay for displaying images and Mermaid diagrams.
 * Renders as a maximized pane with a close button.
 */
export function MediaViewer({ content, onClose }: MediaViewerProps) {
  return (
    <div className="pane pane--media pane--maximized">
      <div className="pane__header">
        <div className="pane__title-group">
          <span>Media</span>
        </div>
        <div className="pane__actions">
          <button
            type="button"
            className="panel__title-button"
            onClick={onClose}
            aria-label="Close media viewer"
            title="Close media viewer (ESC)"
          >
            ×
          </button>
        </div>
      </div>
      <div className="pane__content">
        <div className="media-viewer">
          {content.type === 'image' ? (
            <img 
              src={content.content} 
              alt="Media content" 
              className="media-viewer__image"
            />
          ) : (
            <div className="media-viewer__mermaid-container">
              <MermaidCode>{content.content}</MermaidCode>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MediaViewer;
