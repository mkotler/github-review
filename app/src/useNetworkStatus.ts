import { useEffect, useState, useCallback } from 'react';

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleOnline = () => {
      console.log('🌐 Network: Online');
      setIsOnline(true);
    };

    const handleOffline = () => {
      console.log('🌐 Network: Offline');
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
      console.log('🌐 Network: Detected as offline (network error)');
      setIsOnline(false);
    }
  }, [isOnline]);

  const markOnline = useCallback(() => {
    if (!isOnline) {
      console.log('🌐 Network: Detected as online (successful request)');
      setIsOnline(true);
    }
  }, [isOnline]);

  return { isOnline, markOffline, markOnline };
}
