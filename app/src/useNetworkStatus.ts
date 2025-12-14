import { useEffect, useState, useCallback } from 'react';

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const debugLog = useCallback((...args: unknown[]) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleOnline = () => {
      debugLog('🌐 Network: Online');
      setIsOnline(true);
    };

    const handleOffline = () => {
      debugLog('🌐 Network: Offline');
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const markOffline = useCallback(() => {
    if (isOnline) {
      debugLog('🌐 Network: Detected as offline (network error)');
      setIsOnline(false);
    }
  }, [isOnline, debugLog]);

  const markOnline = useCallback(() => {
    if (!isOnline) {
      debugLog('🌐 Network: Detected as online (successful request)');
      setIsOnline(true);
    }
  }, [isOnline, debugLog]);

  return { isOnline, markOffline, markOnline };
}
