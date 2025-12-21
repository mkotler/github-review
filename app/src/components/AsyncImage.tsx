/**
 * AsyncImage component for loading images from GitHub repositories.
 * Fetches image content via Tauri IPC and displays it as a base64 data URL.
 */

import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getImageMimeType } from "../utils/markdown";

export interface AsyncImageProps {
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Git reference (branch, tag, or SHA) */
  reference: string;
  /** File path within the repository */
  path: string;
  /** Alt text for the image */
  alt?: string;
  /** Click handler */
  onClick?: (e: React.MouseEvent<HTMLImageElement>) => void;
  /** Additional HTML attributes */
  [key: string]: unknown;
}

/**
 * Component that asynchronously loads and displays an image from a GitHub repository.
 * 
 * Features:
 * - Fetches image content via Tauri IPC (cmd_fetch_file_content)
 * - Converts to base64 data URL for display
 * - Handles loading and error states gracefully
 * - Cleanup on unmount to prevent stale updates
 * 
 * @example
 * <AsyncImage
 *   owner="facebook"
 *   repo="react"
 *   reference="main"
 *   path="docs/images/logo.png"
 *   alt="React Logo"
 * />
 */
function AsyncImage({ 
  owner, 
  repo, 
  reference, 
  path, 
  alt, 
  onClick, 
  ...props 
}: AsyncImageProps) {
  const [imageData, setImageData] = useState<string | null>(null);
  const [error, setError] = useState<boolean>(false);
  
  useEffect(() => {
    let cancelled = false;
    
    const fetchImage = async () => {
      try {
        const base64Data = await invoke<string>("cmd_fetch_file_content", {
          owner,
          repo,
          reference,
          path
        });
        
        if (!cancelled) {
          const mimeType = getImageMimeType(path);
          setImageData(`data:${mimeType};base64,${base64Data}`);
        }
      } catch (err) {
        console.error('Failed to fetch image:', { path, error: err });
        if (!cancelled) {
          setError(true);
        }
      }
    };
    
    fetchImage();
    
    return () => {
      cancelled = true;
    };
  }, [owner, repo, reference, path]);
  
  if (error) {
    // Image doesn't exist in the repository - show alt text or a note
    return (
      <span className="image-error" title={`Image not found in repository: ${path}`}>
        {alt ? `[${alt}]` : `[Image: ${path.split('/').pop()}]`}
      </span>
    );
  }
  
  if (!imageData) {
    return null; // Don't show anything while loading to avoid flicker
  }
  
  return (
    <img 
      src={imageData} 
      alt={alt} 
      onClick={onClick}
      className={onClick ? 'clickable-image' : ''}
      {...props} 
    />
  );
}

// Memoize to prevent re-fetching images when parent re-renders
export const MemoizedAsyncImage = React.memo(AsyncImage);

export default AsyncImage;
